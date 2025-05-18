import { NextResponse } from 'next/server';
import { PrismaClient, EquipmentCategory, EquipmentStatus, BorrowStatus } from '@prisma/client';
import { EquipmentSchema } from '@/lib/schemas';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { startOfDay, endOfDay } from 'date-fns';
import { isValid } from 'date-fns';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get('search') || '';
    const categoryParam = url.searchParams.get('category');
    const statusParam = url.searchParams.get('status');
    // Pagination parameters removed
    // const page = parseInt(url.searchParams.get('page') || '1', 10);
    // const limit = parseInt(url.searchParams.get('limit') || '12', 10);
    // const skip = (page - 1) * limit;
    
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let hasDateFilter = false;

    if (startDateParam) {
        const parsedStart = new Date(startDateParam);
        if (isValid(parsedStart)) {
            startDate = startOfDay(parsedStart);
            hasDateFilter = true;
        }
    }
    if (endDateParam) {
        const parsedEnd = new Date(endDateParam);
        if (isValid(parsedEnd)) {
            endDate = endOfDay(parsedEnd);
             hasDateFilter = true;
        }
    }
    if ((startDate && !endDate) || (!startDate && endDate)) {
        console.warn("Date range filter requires both start and end dates.");
        startDate = null;
        endDate = null;
        hasDateFilter = false;
    }

    let whereClause: Prisma.EquipmentWhereInput = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { equipmentId: { contains: search, mode: 'insensitive' } },
      ],
    };

    if (statusParam === EquipmentStatus.ARCHIVED) {
      whereClause.status = EquipmentStatus.ARCHIVED;
    } else {
      whereClause.NOT = {
        ...(whereClause.NOT as Prisma.JsonObject),
        status: EquipmentStatus.ARCHIVED,
      };
    }

    if (categoryParam && categoryParam !== 'ALL') {
      if (Object.values(EquipmentCategory).includes(categoryParam as EquipmentCategory)) {
         whereClause.category = categoryParam as EquipmentCategory;
      } else {
        console.warn(`[API GET /equipment] Invalid category parameter received: ${categoryParam}`);
      }
    }
    
    console.log("[API GET /equipment] Effective whereClause for DB query:", JSON.stringify(whereClause));

    // Total count for pagination removed
    // const trueTotalCount = await prisma.equipment.count({
    //   where: whereClause,
    // });

    // Fetch ALL items from the database matching the whereClause
    const dbItems = await prisma.equipment.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            borrowRecords: true,
          },
        },
        borrowRecords: { 
          where: {
            borrowStatus: { in: [
              BorrowStatus.PENDING, 
              BorrowStatus.APPROVED, 
              BorrowStatus.ACTIVE, 
              BorrowStatus.OVERDUE
            ] },
            OR: [
              {
                borrowStatus: { in: [BorrowStatus.PENDING, BorrowStatus.APPROVED] },
                OR: [
                    { approvedEndTime: { gte: new Date() } }, 
                    { approvedEndTime: null, requestedEndTime: { gte: new Date() } }
                ]
              },
              {
                borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] }
              }
            ]
          },
          select: {
            borrowStatus: true,
            requestedStartTime: true,
            approvedStartTime: true,
            requestedEndTime: true, 
            approvedEndTime: true,
          },
          orderBy: [
            { approvedStartTime: 'asc' },
            { requestedStartTime: 'asc' },
          ],
        }
      },
      orderBy: {
        name: 'asc',
      },
      // skip and take removed for fetching all items
      // skip: skip,
      // take: limit,
    });

    const now = new Date();
    const itemsWithDerivedFields = dbItems.map(item => {
      let nextUpcomingReservationStart: Date | null = null;
      let availableUnitsInFilterRange: number | null = null;
      
      const activeBorrowCount = item.borrowRecords?.filter(
        br => br.borrowStatus === BorrowStatus.ACTIVE || br.borrowStatus === BorrowStatus.OVERDUE
      ).length || 0;

      const futurePendingOrApprovedBorrows = item.borrowRecords?.filter(
        br => (br.borrowStatus === BorrowStatus.PENDING || br.borrowStatus === BorrowStatus.APPROVED) &&
              ((br.approvedStartTime && new Date(br.approvedStartTime) >= now) ||
               (!br.approvedStartTime && br.requestedStartTime && new Date(br.requestedStartTime) >= now)) 
      ).sort((a, b) => { 
          const aStart = a.approvedStartTime || a.requestedStartTime;
          const bStart = b.approvedStartTime || b.requestedStartTime;
          if (!aStart) return 1;
          if (!bStart) return -1;
          return new Date(aStart).getTime() - new Date(bStart).getTime();
      }) || [];
      
      if (futurePendingOrApprovedBorrows.length > 0) {
        const firstUpcoming = futurePendingOrApprovedBorrows[0];
        const upcomingDate = firstUpcoming.approvedStartTime || firstUpcoming.requestedStartTime;
        if (upcomingDate) {
            nextUpcomingReservationStart = new Date(upcomingDate);
        }
      }

      if (hasDateFilter && startDate && endDate) {
        const conflictingFutureBorrowsCount = futurePendingOrApprovedBorrows.filter(borrow => {
          const bStart = borrow.approvedStartTime || borrow.requestedStartTime;
          const bEnd = borrow.approvedEndTime || borrow.requestedEndTime;
          if (bStart && bEnd && startDate && endDate) { // Ensure dates are valid
            return new Date(bStart) < endDate && new Date(bEnd) > startDate;
          }
          return false;
        }).length;
        
        const conflictingActiveBorrowsInFilterRange = item.borrowRecords?.filter(
          br => (br.borrowStatus === BorrowStatus.ACTIVE || br.borrowStatus === BorrowStatus.OVERDUE) &&
                (br.approvedStartTime && br.approvedEndTime && startDate && endDate && // Ensure dates are valid
                 new Date(br.approvedStartTime) < endDate && new Date(br.approvedEndTime) > startDate)
        ).length || 0;

        availableUnitsInFilterRange = Math.max(0, item.stockCount - conflictingFutureBorrowsCount - conflictingActiveBorrowsInFilterRange);
      }

      const prismaStatus = item.status;
      const stockCount = item.stockCount;
      const currentlyEffectivelyAvailableUnits = stockCount - activeBorrowCount;
      let derivedStatus: EquipmentStatus = prismaStatus;

      if (
        prismaStatus === EquipmentStatus.UNDER_MAINTENANCE ||
        prismaStatus === EquipmentStatus.DEFECTIVE ||
        prismaStatus === EquipmentStatus.OUT_OF_COMMISSION ||
        prismaStatus === EquipmentStatus.ARCHIVED
      ) {
        derivedStatus = prismaStatus;
      } else if (currentlyEffectivelyAvailableUnits <= 0 && stockCount > 0) {
        derivedStatus = EquipmentStatus.BORROWED;
      } else if (
        prismaStatus === EquipmentStatus.RESERVED &&
        nextUpcomingReservationStart && 
        nextUpcomingReservationStart > now && 
        currentlyEffectivelyAvailableUnits > 0
      ) {
        derivedStatus = EquipmentStatus.AVAILABLE;
      } else if (prismaStatus === EquipmentStatus.RESERVED && currentlyEffectivelyAvailableUnits <= 0) {
        derivedStatus = EquipmentStatus.RESERVED;
      } else if (prismaStatus === EquipmentStatus.RESERVED && currentlyEffectivelyAvailableUnits > 0) {
        derivedStatus = EquipmentStatus.AVAILABLE;
      } else if (prismaStatus === EquipmentStatus.AVAILABLE && currentlyEffectivelyAvailableUnits > 0) {
        derivedStatus = EquipmentStatus.AVAILABLE;
      }

      if (
        derivedStatus !== EquipmentStatus.BORROWED &&
        derivedStatus !== EquipmentStatus.UNDER_MAINTENANCE &&
        derivedStatus !== EquipmentStatus.DEFECTIVE &&
        derivedStatus !== EquipmentStatus.OUT_OF_COMMISSION &&
        derivedStatus !== EquipmentStatus.ARCHIVED &&
        currentlyEffectivelyAvailableUnits > 0
      ) {
        derivedStatus = EquipmentStatus.AVAILABLE;
      }
      
      const { borrowRecords, ...itemData } = item; 
      return { 
        ...itemData, 
        nextUpcomingReservationStart: nextUpcomingReservationStart ? nextUpcomingReservationStart.toISOString() : null,
        availableUnitsInFilterRange,
        activeBorrowCount,
        derivedStatus 
      };
    });

    let itemsToReturn = itemsWithDerivedFields;
    if (statusParam && statusParam !== 'ALL') {
      if (Object.values(EquipmentStatus).includes(statusParam as EquipmentStatus)) {
        itemsToReturn = itemsWithDerivedFields.filter(
          pItem => pItem.derivedStatus === (statusParam as EquipmentStatus)
        );
      } else {
        console.warn(`[API GET /equipment] Invalid statusParam for derived filtering: ${statusParam}`);
      }
    }
    
    if (hasDateFilter && startDate && endDate) {
        itemsToReturn = itemsToReturn.filter(item => 
            item.availableUnitsInFilterRange !== null && item.availableUnitsInFilterRange > 0
        );
    }

    return NextResponse.json({ items: itemsToReturn }); // Return all processed items, no pagination fields

  } catch (error) {
    console.error('[API GET /equipment] Error fetching equipment:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Validation error.', errors: error.flatten().fieldErrors }, { status: 400 });
    }
    return NextResponse.json({ message: 'Internal Server Error fetching equipment' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validation uses updated EquipmentSchema which includes imageUrl
    const validation = EquipmentSchema.safeParse(body);
    if (!validation.success) {
      console.error("Add equipment validation failed:", validation.error.errors);
      return NextResponse.json(
        { message: 'Invalid input data.', errors: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Destructure imageUrl as well
    const { name, equipmentId, category, condition, status, stockCount, purchaseCost, imageUrl } = validation.data;

    // Optional: Check if equipmentId already exists if provided
    if (equipmentId) {
      const existing = await prisma.equipment.findUnique({ where: { equipmentId } });
      if (existing) {
        return NextResponse.json(
          { message: 'Equipment ID already exists.', errors: { equipmentId: ['This ID is already in use.'] } },
          { status: 409 } // Conflict
        );
      }
    }

    // Create new equipment record
    const newEquipment = await prisma.equipment.create({
      data: {
        name,
        equipmentId: equipmentId || null,
        category,
        condition: condition || null,
        status,
        stockCount,
        purchaseCost: purchaseCost,
        // Save imageUrl into the images array (if provided)
        images: imageUrl ? [imageUrl] : [], 
        editHistory: [],
        maintenanceLog: [],
      },
    });

    console.log("New equipment created:", newEquipment.id);
    return NextResponse.json(newEquipment, { status: 201 });

  } catch (error) {
    console.error("Error creating equipment:", error);
    if (error instanceof z.ZodError) {
      // Should be caught by safeParse, but added as fallback
      return NextResponse.json({ message: 'Validation error processing request.', errors: error.flatten().fieldErrors }, { status: 400 });
    }
    // Add check for other Prisma errors if needed
    // else if (error instanceof Prisma.PrismaClientKnownRequestError) { ... }
    return NextResponse.json({ message: 'An unexpected error occurred.' }, { status: 500 });
  }
} 