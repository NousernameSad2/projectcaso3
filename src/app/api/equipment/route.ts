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
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '12', 10);
    const skip = (page - 1) * limit;
    
    // <<< START: Date Range Params >>>
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let hasDateFilter = false;

    if (startDateParam) {
        const parsedStart = new Date(startDateParam);
        if (isValid(parsedStart)) {
            startDate = startOfDay(parsedStart); // Use start of day for start date
            hasDateFilter = true;
        }
    }
    if (endDateParam) {
        const parsedEnd = new Date(endDateParam);
        if (isValid(parsedEnd)) {
            endDate = endOfDay(parsedEnd); // Use end of day for end date
             hasDateFilter = true;
        }
    }
    // If only one date is provided, maybe default the other? For now, requires both for range.
    if ((startDate && !endDate) || (!startDate && endDate)) {
        // Or maybe treat single date as wanting availability *on* that day?
        // For simplicity, let's clear if only one is valid for now.
        console.warn("Date range filter requires both start and end dates.");
        startDate = null;
        endDate = null;
        hasDateFilter = false;
    }
    // <<< END: Date Range Params >>>

    // Base where clause
    let whereClause: Prisma.EquipmentWhereInput = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { equipmentId: { contains: search, mode: 'insensitive' } },
      ],
      // We will not filter by item.status directly here anymore if a statusParam is provided.
      // That will be handled by derivedStatus after fetching.
      // However, if statusParam is for a specific non-derivable status like ARCHIVED,
      // or if NO statusParam is given (meaning "ALL" but perhaps still excluding ARCHIVED by default),
      // we might add conditions here.
      // For now, let's keep it simple: if statusParam is ARCHIVED, filter it here.
      // Otherwise, fetch broader and filter by derived status later.
    };

    if (statusParam === EquipmentStatus.ARCHIVED) {
      whereClause.status = EquipmentStatus.ARCHIVED;
    } else {
      // Exclude ARCHIVED items unless explicitly requested.
      // This ensures they don't appear in "ALL" or other derived statuses unless their prismaStatus is ARCHIVED.
      whereClause.NOT = {
        ...(whereClause.NOT as Prisma.JsonObject), // Preserve other NOT conditions if any
        status: EquipmentStatus.ARCHIVED,
      };
    }

    // Add category filter
    if (categoryParam && categoryParam !== 'ALL') {
      if (Object.values(EquipmentCategory).includes(categoryParam as EquipmentCategory)) {
         whereClause.category = categoryParam as EquipmentCategory;
      } else {
        console.warn(`[API GET /equipment] Invalid category parameter received: ${categoryParam}`);
      }
    }

    // REMOVED: Original direct status filter:
    // if (statusParam && statusParam !== 'ALL' && statusParam !== EquipmentStatus.ARCHIVED) { // ARCHIVED handled above
    //   if (Object.values(EquipmentStatus).includes(statusParam as EquipmentStatus)) {
    //      // whereClause.status = statusParam as EquipmentStatus; // This line is removed
    //   } else {
    //      console.warn(`[API GET /equipment] Invalid status parameter received: ${statusParam}`);
    //   }
    // }
    
    // <<< START: Date Range Filtering Logic >>>
    // if (hasDateFilter && startDate && endDate) { // Entire block REMOVED
    //   console.log(`[API GET /equipment] Applying date filter: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    //   const conflictingBorrowStatuses: BorrowStatus[] = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE];
      
    //   // The following modification to whereClause.NOT is removed because it's too strict for stockCount > 1.
    //   // Date range availability will be handled by post-processing availableUnitsInFilterRange.
    //   // whereClause.NOT = {
    //   //   ...(whereClause.NOT as Prisma.JsonObject), // Preserve other NOT conditions (e.g., for ARCHIVED status)
    //   //   borrowRecords: {
    //   //     some: {
    //   //       borrowStatus: { in: conflictingBorrowStatuses },
    //   //       OR: [
    //   //         { approvedStartTime: { lt: endDate }, approvedEndTime: { gt: startDate } },
    //   //       ]
    //   //     }
    //   //   }
    //   // };
    // }
    // <<< END: Date Range Filtering Logic >>>

    // --- DEBUG LOG --- 
    console.log("[API GET /equipment] Effective whereClause for DB query:", JSON.stringify(whereClause));
    // --- END DEBUG LOG ---

    // Fetch paginated items
    const allMatchingDbItems = await prisma.equipment.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            borrowRecords: true, // This counts all borrow records
          },
        },
        borrowRecords: { // Fetch all potentially relevant borrow records
          where: {
            borrowStatus: { in: [
              BorrowStatus.PENDING, 
              BorrowStatus.APPROVED, 
              BorrowStatus.ACTIVE, 
              BorrowStatus.OVERDUE
            ] },
            // We only care about reservations that haven't ended or are active
            // For PENDING/APPROVED: their requested/approved end time must be in the future
            // For ACTIVE/OVERDUE: they are ongoing by definition
            OR: [
              // PENDING or APPROVED that are for the future or current (overlapping today)
              {
                borrowStatus: { in: [BorrowStatus.PENDING, BorrowStatus.APPROVED] },
                OR: [
                    { approvedEndTime: { gte: new Date() } }, 
                    { approvedEndTime: null, requestedEndTime: { gte: new Date() } }
                ]
              },
              // ACTIVE or OVERDUE (these are inherently current or past due)
              {
                borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] }
              }
            ]
          },
          select: {
            borrowStatus: true, // Need status to differentiate
            requestedStartTime: true,
            approvedStartTime: true,
            requestedEndTime: true, 
            approvedEndTime: true,
          },
          orderBy: [
            { approvedStartTime: 'asc' }, // Keep ordering for nextUpcomingReservation
            { requestedStartTime: 'asc' },
          ],
        }
      },
      orderBy: {
        name: 'asc',
      },
      skip: skip,
      take: limit,
    });

    // Process items to add nextUpcomingReservationStart, availableUnitsInFilterRange, activeBorrowCount, and derivedStatus
    const now = new Date(); // For derivedStatus calculation

    const itemsWithDerivedStatus = allMatchingDbItems.map(item => {
      let nextUpcomingReservationStart: Date | null = null;
      let availableUnitsInFilterRange: number | null = null;
      
      const activeBorrowCount = item.borrowRecords?.filter(
        br => br.borrowStatus === BorrowStatus.ACTIVE || br.borrowStatus === BorrowStatus.OVERDUE
      ).length || 0;

      const futurePendingOrApprovedBorrows = item.borrowRecords?.filter(
        br => (br.borrowStatus === BorrowStatus.PENDING || br.borrowStatus === BorrowStatus.APPROVED) &&
              ((br.approvedStartTime && new Date(br.approvedStartTime) >= now) || // Ensure it's truly upcoming or current
               (!br.approvedStartTime && br.requestedStartTime && new Date(br.requestedStartTime) >= now)) 
      ).sort((a, b) => { // Sort to get the earliest upcoming
          const aStart = a.approvedStartTime || a.requestedStartTime;
          const bStart = b.approvedStartTime || b.requestedStartTime;
          if (!aStart) return 1;
          if (!bStart) return -1;
          return new Date(aStart).getTime() - new Date(bStart).getTime();
      }) || [];
      

      if (futurePendingOrApprovedBorrows.length > 0) {
        const firstUpcoming = futurePendingOrApprovedBorrows[0];
        // Ensure the date is valid before assigning
        const upcomingDate = firstUpcoming.approvedStartTime || firstUpcoming.requestedStartTime;
        if (upcomingDate) {
            nextUpcomingReservationStart = new Date(upcomingDate);
        }
      }

      if (hasDateFilter && startDate && endDate) {
        const conflictingFutureBorrowsCount = futurePendingOrApprovedBorrows.filter(borrow => {
          const bStart = borrow.approvedStartTime || borrow.requestedStartTime;
          const bEnd = borrow.approvedEndTime || borrow.requestedEndTime;
          return bStart < endDate! && bEnd > startDate!;
        }).length;
        
        const conflictingActiveBorrowsInFilterRange = item.borrowRecords?.filter(
          br => (br.borrowStatus === BorrowStatus.ACTIVE || br.borrowStatus === BorrowStatus.OVERDUE) &&
                // Assuming active/overdue borrows always have approved start/end times for simplicity here
                // A more robust check would use actual checkoutTime and expected/approvedEndTime
                (br.approvedStartTime && br.approvedEndTime && br.approvedStartTime < endDate! && br.approvedEndTime > startDate!)
        ).length || 0;

        availableUnitsInFilterRange = Math.max(0, item.stockCount - conflictingFutureBorrowsCount - conflictingActiveBorrowsInFilterRange);
      }

      // Calculate derivedStatus (logic from EquipmentCard.tsx)
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
        nextUpcomingReservationStart && // Already a Date object or null
        nextUpcomingReservationStart > now && // Check if it's in the future
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
      // This condition implies prismaStatus being AVAILABLE but units <= 0, which should be BORROWED
      // else if (prismaStatus === EquipmentStatus.AVAILABLE && currentlyEffectivelyAvailableUnits <= 0 && stockCount > 0) {
      //   derivedStatus = EquipmentStatus.BORROWED; // Covered by the earlier BORROWED check
      // }


      // Final override from EquipmentCard display logic
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
      
      const { borrowRecords, ...itemData } = item; // Exclude raw borrowRecords from final response
      return { ...itemData, nextUpcomingReservationStart, availableUnitsInFilterRange, activeBorrowCount, derivedStatus };
    });

    // Filter by derivedStatus if statusParam is present (and not 'ALL')
    let itemsFilteredByDerivedStatus = itemsWithDerivedStatus;
    if (statusParam && statusParam !== 'ALL') {
      if (Object.values(EquipmentStatus).includes(statusParam as EquipmentStatus)) {
        itemsFilteredByDerivedStatus = itemsWithDerivedStatus.filter(
          pItem => pItem.derivedStatus === (statusParam as EquipmentStatus)
        );
      } else {
        // This case should ideally not be hit if frontend sends valid statuses
        console.warn(`[API GET /equipment] Invalid statusParam for derived filtering: ${statusParam}`);
      }
    }
    
    // If date filter is active, and user asked for AVAILABLE, further filter by availableUnitsInFilterRange
    // This ensures "AVAILABLE" with date range means truly available in that range.
    let finalFilteredItems = itemsFilteredByDerivedStatus;
    if (hasDateFilter && startDate && endDate) { // NEW Condition: Apply if any date filter is active
        finalFilteredItems = itemsFilteredByDerivedStatus.filter(item => 
            item.availableUnitsInFilterRange !== null && item.availableUnitsInFilterRange > 0
        );
    }
    // Re-paginate based on the final filtered list.
    const totalItems = finalFilteredItems.length;
    const totalPages = Math.ceil(totalItems / limit) || 1; // Ensure totalPages is at least 1
    const paginatedItems = finalFilteredItems.slice(skip, skip + limit);

    return NextResponse.json({
      items: paginatedItems, // Send the paginated items
      totalPages, 
      currentPage: page
    });

  } catch (error) {
    console.error("API Error - GET /api/equipment:", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
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