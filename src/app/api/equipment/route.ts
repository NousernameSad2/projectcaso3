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
      include: { // Include count of related borrows
        _count: {
          select: { borrowRecords: true }, // Correct relation name?
        },
      },
      orderBy: {
        name: 'asc', // Default sort order
      },
      skip: skip,
      take: limit,
    });

    return NextResponse.json({ 
      items, 
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