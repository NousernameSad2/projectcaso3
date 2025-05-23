import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ReservationSchema } from '@/lib/schemas';
import { UserRole, BorrowStatus, Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import { createId } from '@paralleldrive/cuid2';

// GET: Fetch borrow records, optionally filtering by status
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    // 1. Authentication Check (Moved up)
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const userId = session.user.id;
    const userRole = session.user.role as UserRole;

    // 2. Check Authorization for this specific action (Fetching borrows)
    // Allow Staff to see all, Faculty to see theirs, others forbidden
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
    if (!allowedRoles.includes(userRole)) {
        console.warn(`User ${userId} with role ${userRole} attempted to fetch dashboard borrows.`);
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions.' }, { status: 403 });
    }

    const url = new URL(req.url);
    const statusParams = url.searchParams.getAll('status');
    const statusFilter = statusParams.length > 0 ? statusParams as BorrowStatus[] : undefined;

    try {
        // --- START: Update Overdue Status for ALL active borrows --- 
        const now = new Date();
        await prisma.borrow.updateMany({
            where: {
                // No user filter here - check all active borrows
                borrowStatus: BorrowStatus.ACTIVE,
                approvedEndTime: { lt: now } // Check against approved end time
            },
            data: {
                borrowStatus: BorrowStatus.OVERDUE,
            },
        });
        // --- END: Update Overdue Status --- 

        // --- START: Build Prisma Where Clause with Role-Based Filtering ---
        const whereClause: Prisma.BorrowWhereInput = {};

        if (statusFilter) {
            whereClause.borrowStatus = { in: statusFilter };
        }

        // *** NEW: Add FIC filtering for FACULTY role ***
        if (userRole === UserRole.FACULTY) {
            whereClause.class = {
                ficId: userId // Only show borrows where the class's ficId matches the faculty's ID
            };
        }
        // STAFF sees all borrows matching the status filter (no additional class filter needed)
        // --- END: Build Prisma Where Clause ---

        // Fetch borrows using the constructed where clause
        const borrows = await prisma.borrow.findMany({
            where: whereClause, // Apply the role-based where clause
            include: {
                equipment: { 
                    select: { id: true, name: true, equipmentId: true, images: true, status: true }
                },
                borrower: { 
                    select: { id: true, name: true, email: true }
                },
                 // Include class/fic details if needed by the dashboard
                 class: { 
                    select: { courseCode: true, section: true, academicYear: true, ficId: true } // Ensure ficId is selected
                 },
                 // Remove fic include here as we filter by class.ficId
                 // fic: { select: { name: true } } 
            },
            orderBy: {
                // Order appropriately for different views
                requestSubmissionTime: 'asc',
            },
        });
        return NextResponse.json(borrows);
    } catch (_error) {
        console.error("API Error - GET /api/borrows:", _error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
  // 1. Authenticate the user
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // 2. Parse and Validate Request Body
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = ReservationSchema.safeParse(body); 

    if (!parsedData.success) {
      console.error("Validation Errors:", parsedData.error.flatten());
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    // Destructure data using correct field names from reverted schema
    const { equipmentIds, requestedStartTime, requestedEndTime, classId, groupMateIds } = parsedData.data;

    // --- Add detailed logging for incoming dates ---
    console.log("Backend Validation - Original requestedStartTime:", body.requestedStartTime, "Parsed:", requestedStartTime.toISOString(), "Server Local:", requestedStartTime.toString());
    console.log("Backend Validation - Original requestedEndTime:", body.requestedEndTime, "Parsed:", requestedEndTime.toISOString(), "Server Local:", requestedEndTime.toString());
    // --- End detailed logging ---

    // --- START: Validate Reservation Time Window ---    
    const startHour = requestedStartTime.getHours();
    const endHour = requestedEndTime.getHours();

    console.log("Backend Validation - Start Hour (server local):", startHour, "End Hour (server local):", endHour);

    if (startHour < 6 || startHour >= 20 || endHour < 6 || endHour >= 20) {
      return NextResponse.json({ message: 'Reservations must be between 6:00 AM and 8:00 PM.' }, { status: 400 });
    }
    // --- END: Validate Reservation Time Window --- 

    // --- START: Check for Equipment Availability (Updated Logic) ---
    const blockingStatuses: BorrowStatus[] = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE]; 
    const unavailableItemsInfo: { name: string; id: string }[] = [];

    for (const eqId of equipmentIds) {
        const equipment = await prisma.equipment.findUnique({
            where: { id: eqId },
            select: { stockCount: true, name: true }
        });

        if (!equipment) {
            // Collect all invalid IDs? For now, fail fast.
            return NextResponse.json({ message: `Equipment with ID ${eqId} not found.` }, { status: 404 });
        }
        if (equipment.stockCount <= 0) {
             unavailableItemsInfo.push({ name: equipment.name, id: eqId });
             continue;
        }

        // Find count of CONFIRMED overlapping borrows 
        // Uses requested times of existing borrows for simplicity - refine later if needed
        const overlappingBorrowsCount = await prisma.borrow.count({
            where: {
                equipmentId: eqId,
                borrowStatus: { in: blockingStatuses },
                AND: [
                    { // Existing borrow starts before requested ends
                        OR: [
                            { approvedStartTime: { lt: requestedEndTime } },
                            { approvedStartTime: null, requestedStartTime: { lt: requestedEndTime } }
                        ]
                    },
                    { // Existing borrow ends after requested starts
                        OR: [
                            { approvedEndTime: { gt: requestedStartTime } }, 
                            { approvedEndTime: null, requestedEndTime: { gt: requestedStartTime } }
                        ]
                    }
                ]
            }
        });

        if (overlappingBorrowsCount >= equipment.stockCount) {
             unavailableItemsInfo.push({ name: equipment.name, id: eqId });
        }
    }

    // Handle Unavailable Items
    if (unavailableItemsInfo.length > 0) {
        const unavailableNames = unavailableItemsInfo.map(item => `${item.name} (ID: ${item.id})`);
        const uniqueUnavailableNames = [...new Set(unavailableNames)];
        return NextResponse.json(
            { message: `Insufficient stock for the following items for the selected date/time range: ${uniqueUnavailableNames.join(', ')}.` },
            { status: 409 } 
        );
    }
    // --- END Check for Equipment Availability ---

    // --- Find Group Mate User IDs --- 
    // No longer needed - Frontend sends IDs directly
    // let groupMateUserIds: string[] = [];
    // if (groupMates && groupMates.trim() !== '') { ... }
    // --- End Find Group Mate User IDs ---

    // 3. Create Borrow Records and Group Links (Transaction)
    let createdBorrowsResult: { id: string; borrowGroupId?: string | null }[] = [];
    let generatedBorrowGroupId: string | null = null; // Variable to hold generated group ID

    try {
        // --- Generate Group ID if Mates Exist --- 
        if (groupMateIds && groupMateIds.length > 0) {
            generatedBorrowGroupId = createId(); // Use createId() instead of cuid()
            console.log(`Generated BorrowGroup ID for linking: ${generatedBorrowGroupId}`);
        }
        // --- End Generate Group ID ---

        createdBorrowsResult = await prisma.$transaction(async (tx) => {
            // Step 1: Create the Borrow records
            const createBorrowPromises = equipmentIds.map((eqId: string) =>
                tx.borrow.create({
                    data: {
                        borrowerId: userId,
                        equipmentId: eqId,
                        requestedStartTime: requestedStartTime,
                        requestedEndTime: requestedEndTime,
                        borrowStatus: BorrowStatus.PENDING,
                        classId: classId,
                        borrowGroupId: generatedBorrowGroupId, // Use the generated group ID (null if no mates)
                    },
                    select: { id: true, borrowGroupId: true } 
                })
            );
            const createdBorrows = await Promise.all(createBorrowPromises);
            console.log(`Created ${createdBorrows.length} borrow records.`);

            // Step 2: Link Group Mates if a group ID was generated
            if (generatedBorrowGroupId && groupMateIds && groupMateIds.length > 0) {
                const allUserIdsInGroup = new Set<string>([userId, ...groupMateIds]); // Include borrower
                const borrowGroupMateLinks = Array.from(allUserIdsInGroup).map(memberUserId => ({
                    borrowGroupId: generatedBorrowGroupId!, // Use the generated ID
                    userId: memberUserId
                }));
                
                if (borrowGroupMateLinks.length > 0) {
                    // Use the correct model name from schema
                    await tx.borrowGroupMate.createMany({
                        data: borrowGroupMateLinks,
                    });
                    console.log(`Created ${borrowGroupMateLinks.length} group mate links for group ${generatedBorrowGroupId}.`);
                }
            }

            return createdBorrows; 
        });
        
    } catch (error: unknown) {
        console.error("API Error - POST /api/borrows:", error);
        // Basic error handling, can be expanded
        const message = error instanceof Error ? error.message : "An unexpected error occurred during reservation.";
        return NextResponse.json({ message }, { status: 500 });
    }
    
    // 4. Return Success Response
    return NextResponse.json(
        { 
            message: `Reservation request submitted successfully for ${createdBorrowsResult.length} item(s).${generatedBorrowGroupId ? ` Group ID: ${generatedBorrowGroupId}` : ''}`, 
            borrows: createdBorrowsResult 
        }, 
        { status: 201 }
    );

  } catch (error) {
    console.error("API Error - POST /api/borrows:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid input', errors: error.errors }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return NextResponse.json({ message: 'A database error occurred.' }, { status: 500 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 