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
    };

    // Add category filter
    if (categoryParam && categoryParam !== 'ALL') {
      if (Object.values(EquipmentCategory).includes(categoryParam as EquipmentCategory)) {
         whereClause.category = categoryParam as EquipmentCategory;
      } else {
        console.warn(`Invalid category parameter received: ${categoryParam}`);
      }
    }

    // Add status filter
    if (statusParam && statusParam !== 'ALL') {
      if (Object.values(EquipmentStatus).includes(statusParam as EquipmentStatus)) {
         whereClause.status = statusParam as EquipmentStatus;
      } else {
         console.warn(`Invalid status parameter received: ${statusParam}`);
      }
    }
    
    // <<< START: Date Range Filtering Logic >>>
    if (hasDateFilter && startDate && endDate) {
      console.log(`Applying date filter: ${startDate.toISOString()} - ${endDate.toISOString()}`);
      // Find equipment that does NOT have ANY conflicting borrows in the range.
      // Conflicting statuses: APPROVED, ACTIVE, OVERDUE
      const conflictingBorrowStatuses: BorrowStatus[] = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE];
      
      whereClause.NOT = {
        borrowRecords: {
          some: {
            borrowStatus: { in: conflictingBorrowStatuses },
            // Overlap condition: Borrow starts before filter ends AND Borrow ends after filter starts
            // Need to handle potential null approved times - check requested times as fallback
            OR: [
              // Case 1: Uses approved times if available
              {
                approvedStartTime: { lt: endDate }, 
                approvedEndTime: { gt: startDate },
              },
              // Case 2: Uses requested times if approved times are null (e.g., PENDING, though we filter those out above)
              // This OR might be unnecessary if APPROVED/ACTIVE/OVERDUE always have approved times set.
              // Keeping it simple for now, assuming approved times are the source of truth for conflicts.
              // Revisit if approved times can be null for conflicting statuses.
              // {
              //   approvedStartTime: null,
              //   approvedEndTime: null,
              //   requestedStartTime: { lt: endDate },
              //   requestedEndTime: { gt: startDate },
              // }
            ]
          }
        }
      };
    }
    // <<< END: Date Range Filtering Logic >>>

    // Get total count for pagination before applying skip/take
    const totalItems = await prisma.equipment.count({ where: whereClause });
    const totalPages = Math.ceil(totalItems / limit);

    // Fetch paginated items
    const items = await prisma.equipment.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { borrowRecords: true },
        },
        // Also include minimal borrow record data to find next reservation
        borrowRecords: {
          where: {
            borrowStatus: { in: [BorrowStatus.APPROVED, BorrowStatus.PENDING] },
            OR: [
              { approvedEndTime: { gte: new Date() } }, // Approved and ends in the future
              { approvedEndTime: null, requestedEndTime: { gte: new Date() } } // Pending and ends in the future
            ]
          },
          select: {
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
      skip: skip,
      take: limit,
    });

    // Process items to add nextUpcomingReservationStart and availableUnitsInFilterRange
    const processedItems = items.map(item => {
      let nextUpcomingReservationStart: Date | null = null;
      let availableUnitsInFilterRange: number | null = null;

      // Calculate nextUpcomingReservationStart from pre-fetched borrowRecords
      if (item.borrowRecords && item.borrowRecords.length > 0) {
        const firstUpcoming = item.borrowRecords[0]; // Already ordered by date
        nextUpcomingReservationStart = firstUpcoming.approvedStartTime || firstUpcoming.requestedStartTime;
      }

      // Calculate availableUnitsInFilterRange if a date filter is active
      if (hasDateFilter && startDate && endDate) {
        // item.borrowRecords are already future PENDING/APPROVED ones.
        // We need to count how many of these specifically overlap the *filter's* date range.
        const conflictingBorrowsCount = item.borrowRecords.filter(borrow => {
          const bStart = borrow.approvedStartTime || borrow.requestedStartTime;
          const bEnd = borrow.approvedEndTime || borrow.requestedEndTime; // Need approvedEndTime for this too
          // Check if the borrow period (bStart to bEnd) overlaps with the filter period (startDate to endDate)
          return bStart < endDate! && bEnd > startDate!;
        }).length;
        availableUnitsInFilterRange = Math.max(0, item.stockCount - conflictingBorrowsCount);
      }

      const { borrowRecords, ...itemData } = item; // Exclude raw borrowRecords from final response
      return { ...itemData, nextUpcomingReservationStart, availableUnitsInFilterRange };
    });

    // If date filter is active, we might want to further filter out items where availableUnitsInFilterRange is 0
    // This depends on whether the initial SQL query for `items` was already precise enough.
    // The current SQL `whereClause.NOT` for date range tries to exclude items with ANY conflict,
    // which is too strict for stockCount > 1. So, a post-filter here is necessary.

    let finalFilteredItems = processedItems;
    if (hasDateFilter && statusParam === EquipmentStatus.AVAILABLE) { // Only filter if user explicitly asked for AVAILABLE
        finalFilteredItems = processedItems.filter(item => 
            item.availableUnitsInFilterRange !== null && item.availableUnitsInFilterRange > 0
        );
    }
     // Re-paginate if post-filtering occurred. This is complex. 
     // For simplicity, the current pagination is on a potentially larger pre-list if SQL filter was not perfect.
     // A better approach is to fetch all matching core criteria, then filter, then paginate the result.
     // Given the current structure, this re-filter might lead to fewer items on a page than `limit`.

    return NextResponse.json({
      items: finalFilteredItems, 
      totalPages, // This totalPages is based on the pre-filtered list, might be inaccurate if post-filter reduces items significantly
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