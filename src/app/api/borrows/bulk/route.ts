import { NextRequest, NextResponse } from 'next/server';
import { z } from "zod";
import { Prisma, UserRole, DeficiencyStatus } from '@prisma/client';
import { BorrowStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createId } from '@paralleldrive/cuid2'; 
// Remove date-fns imports if no longer needed for calculation
// import { startOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

// Define validation schema for bulk borrow request
const bulkBorrowSchema = z.object({
  equipmentIds: z.array(z.string().min(1)).min(1, "At least one equipment ID is required"),
  classId: z.string().min(1, "Class ID is required"),
  // Update to expect DateTime strings (ISO 8601) from frontend
  requestedStartTime: z.string().datetime({ message: "Invalid start date/time format." }),
  requestedEndTime: z.string().datetime({ message: "Invalid end date/time format." }),
  groupMateIds: z.array(z.string().min(1)).optional(), // ADDED: Optional array of user IDs
}).refine((data) => new Date(data.requestedEndTime) > new Date(data.requestedStartTime), {
  message: "End time must be after start time.",
  path: ["requestedEndTime"],
});

// Removed combineDateAndTime helper

export async function POST(request: Request) {
  // 1. Get User Session
  const session = await getServerSession(authOptions); 
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id; 
  
  // 2. Parse and Validate Request Body
  let validatedData;
  try {
    const body = await request.json();
    validatedData = bulkBorrowSchema.parse(body);
  } catch (error) {
     // ... Zod error handling ...
     return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  // Use validated names matching the updated schema
  const { equipmentIds, classId, requestedStartTime, requestedEndTime, groupMateIds } = validatedData;

  // Convert ISO strings to Date objects for Prisma
  const startTime = new Date(requestedStartTime);
  const endTime = new Date(requestedEndTime);

  // --- START: Check for Equipment Availability (Using Updated Logic) ---
  const blockingStatuses: BorrowStatus[] = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE];
  const unavailableItemsInfo: { name: string; id: string }[] = [];

  for (const eqId of equipmentIds) {
      const equipment = await prisma.equipment.findUnique({
          where: { id: eqId },
          select: { stockCount: true, name: true }
      });

      if (!equipment) {
           return NextResponse.json({ message: `Equipment with ID ${eqId} not found.` }, { status: 404 });
      }
      if (equipment.stockCount <= 0) {
           unavailableItemsInfo.push({ name: equipment.name, id: eqId });
           continue;
      }

      // Use converted startTime and endTime for overlap check
      const overlappingBorrowsCount = await prisma.borrow.count({
          where: {
              equipmentId: eqId,
              borrowStatus: { in: blockingStatuses },
              AND: [
                   { // Existing borrow starts before requested ends
                       OR: [
                           // @ts-ignore - Ignore type error if persist
                           { approvedStartTime: { lt: endTime } },
                           // @ts-ignore - Ignore type error if persist
                           { approvedStartTime: null, requestedStartTime: { lt: endTime } } 
                       ]
                   },
                   { // Existing borrow ends after requested starts
                       OR: [
                           // @ts-ignore - Ignore type error if persist
                           { approvedEndTime: { gt: startTime } }, 
                           // @ts-ignore - Ignore type error if persist
                           { approvedEndTime: null, requestedEndTime: { gt: startTime } } 
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
       // ... return unavailable response ...
       const unavailableNames = unavailableItemsInfo.map(item => `${item.name} (ID: ${item.id})`);
       const uniqueUnavailableNames = [...new Set(unavailableNames)];
       return NextResponse.json(
           { message: `Insufficient stock: ${uniqueUnavailableNames.join(', ')}.` },
           { status: 409 } 
       );
  }
  // --- END Check for Equipment Availability ---

  // 3. Generate a unique Group ID
  const borrowGroupId = createId();

  // 4. Prepare data for batch creation using Date objects
  const borrowData = equipmentIds.map((equipmentId) => ({
    borrowGroupId: borrowGroupId,
    borrowerId: userId,
    equipmentId: equipmentId,
    classId: classId,
    requestedStartTime: startTime, 
    requestedEndTime: endTime,   
    borrowStatus: BorrowStatus.PENDING,
  }));

  // 5. Create Borrow Records in Batch (and Group Mates if provided)
  try {
    // Create Borrow Records
    const borrowResult = await prisma.borrow.createMany({
      // @ts-ignore - Ignore persistent type error due to schema changes
      data: borrowData,
      // If MongoDB, skip transaction for simplicity for now. Ensure data structures match.
      // skipTransaction: true, // Might be needed depending on Prisma/DB version
    });

    if (borrowResult.count !== equipmentIds.length) {
        console.warn(`Bulk borrow creation for group ${borrowGroupId}: Expected ${equipmentIds.length} records, created ${borrowResult.count}.`);
        // Decide if this is an error or just a warning. For now, proceed but log.
    }

    // If groupMateIds were provided, create BorrowGroupMate entries
    let groupMateResultCount = 0;
    if (groupMateIds && groupMateIds.length > 0) {
        const allMemberIds = Array.from(new Set([userId, ...groupMateIds])); 
        
        const groupMateData = allMemberIds.map(mateId => ({
            borrowGroupId: borrowGroupId,
            userId: mateId,
        }));

        const groupMateResult = await prisma.borrowGroupMate.createMany({
            data: groupMateData
        });
        groupMateResultCount = groupMateResult.count;
        console.log(`Added ${groupMateResultCount} members to borrow group ${borrowGroupId}.`);
    }

    // 6. Return Success Response
    return NextResponse.json(
      {
        message: `${borrowResult.count} borrow requests created successfully for group ${borrowGroupId}. ${groupMateResultCount > 0 ? ` ${groupMateResultCount} members associated.` : ''}`, // Updated message
        borrowGroupId: borrowGroupId,
        borrowCount: borrowResult.count,
        groupMemberCount: groupMateResultCount
      },
      { status: 201 }
    );

  } catch (error) {
     // Improved error logging
     console.error(`Error during bulk borrow creation (Group ID attempted: ${borrowGroupId}):`, error);
     if (error instanceof z.ZodError) {
        // Should have been caught earlier, but as a fallback
        return NextResponse.json({ error: 'Invalid request data.', details: error.flatten() }, { status: 400 });
     } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Handle potential Prisma errors (e.g., unique constraint violation if skipDuplicates wasn't used)
        console.error("Prisma Error Code:", error.code);
        return NextResponse.json({ error: `Database error during creation: ${error.message}` }, { status: 500 });
     }
     // General error
     return NextResponse.json({ error: 'Failed to create bulk reservation.' }, { status: 500 });
  }
} 

// PATCH: Bulk update status (e.g., checkout, approve)
export async function PATCH(request: NextRequest) {
    const session = await getServerSession(authOptions);
    const user = session?.user;
    
    // Check authorization (Staff/Faculty)
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userRole = user.role as UserRole;
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
    if (!userRole || !allowedRoles.includes(userRole)) {
        return NextResponse.json({ error: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }
    const actorId = user.id;

    const url = new URL(request.url);
    const groupId = url.searchParams.get('groupId');
    const action = url.searchParams.get('action'); // e.g., 'checkout', 'approve'

    console.log(`[API PATCH /api/borrows/bulk] Received request: groupId=${groupId}, action=${action}`);

    if (!groupId) {
        return NextResponse.json({ error: 'groupId parameter is required' }, { status: 400 });
    }

    // Reverted: Removed 'reject' from valid actions
    const validActions = ['checkout', 'approve'];
    if (!action || !validActions.includes(action)) { 
        return NextResponse.json({ error: `Invalid or missing action specified. Valid actions: ${validActions.join(', ')}` }, { status: 400 });
    }

    try {
        // 3. Identify Target Borrows based on groupId
        const borrowsToUpdate = await prisma.borrow.findMany({
            where: { borrowGroupId: groupId },
            select: { id: true, borrowStatus: true, equipmentId: true } // Select needed fields
        });

        if (borrowsToUpdate.length === 0) {
            return NextResponse.json({ error: `No borrows found for group ${groupId}` }, { status: 404 });
        }

        // 4. Perform Action based on 'action' parameter
        let updateResult: Prisma.BatchPayload;
        let successMessage = '';
        let autoRejectedCount = 0; // <<< Add counter for auto-rejected borrows

        if (action === 'approve') {
            // --- Bulk Approve Logic (with Auto-Rejection) ---
            console.log(`[API Bulk PATCH - Group ${groupId}] Approving with auto-rejection...`);

            // Use a transaction to ensure atomicity
            try {
                const { approvedCount, rejectedCount } = await prisma.$transaction(async (tx) => {
                    // 1. Find PENDING items in the target group
                    const borrowsToApprove = await tx.borrow.findMany({
                        where: { 
                            borrowGroupId: groupId, 
                            borrowStatus: BorrowStatus.PENDING 
                        },
                        select: { 
                            id: true, 
                            equipmentId: true, 
                            requestedStartTime: true, 
                            requestedEndTime: true 
                        }
                    });

                    if (borrowsToApprove.length === 0) {
                        // If no items to approve, return 0 counts immediately
                        return { approvedCount: 0, rejectedCount: 0 }; 
                    }

                    const approvedItemIds = borrowsToApprove.map(b => b.id);
                    let currentApprovedCount = 0;
                    let currentRejectedCount = 0;
                    const rejectionStatus = userRole === UserRole.FACULTY ? BorrowStatus.REJECTED_FIC : BorrowStatus.REJECTED_STAFF;

                    // 2. Approve each item and find/reject overlaps
                    for (const borrow of borrowsToApprove) {
                        // Approve the current item
                        await tx.borrow.update({
                            where: { id: borrow.id },
                            data: {
                                borrowStatus: BorrowStatus.APPROVED,
                                approvedByStaffId: userRole === UserRole.STAFF ? actorId : undefined,
                                approvedByFicId: userRole === UserRole.FACULTY ? actorId : undefined,
                                approvedStartTime: new Date(),
                                // Set approved times based on requested for now (can be adjusted)
                                approvedEndTime: borrow.requestedEndTime,
                            }
                        });
                        currentApprovedCount++;

                        // 3. Find overlapping PENDING requests for the SAME equipment 
                        //    (excluding the current group being approved)
                        const overlappingPending = await tx.borrow.findMany({
                            where: {
                                equipmentId: borrow.equipmentId,
                                borrowStatus: BorrowStatus.PENDING,
                                id: { notIn: approvedItemIds }, // Exclude items we are currently approving
                                borrowGroupId: { not: groupId }, // Ensure we don\'t reject other items in the same group (if any weird state)
                                AND: [
                                    { requestedStartTime: { lt: borrow.requestedEndTime } }, // Overlap condition 1
                                    { requestedEndTime: { gt: borrow.requestedStartTime } }  // Overlap condition 2
                                ]
                            },
                            select: { id: true } // Only need IDs
                        });

                        // 4. Reject the overlapping requests
                        const overlappingIds = overlappingPending.map(b => b.id);
                        if (overlappingIds.length > 0) {
                            const rejectResult = await tx.borrow.updateMany({
                                where: { id: { in: overlappingIds } },
                                data: { borrowStatus: rejectionStatus }
                            });
                            currentRejectedCount += rejectResult.count;
                            console.log(`[API Bulk Approve TX - Group ${groupId}] Auto-rejected ${rejectResult.count} overlapping requests for equipment ${borrow.equipmentId}.`);
                        }
                    }
                    // Return counts from transaction
                    return { approvedCount: currentApprovedCount, rejectedCount: currentRejectedCount }; 
                }); // End Transaction

                // Handle case where transaction ran but found no items to approve
                if (approvedCount === 0) {
                     return NextResponse.json({ message: `No pending requests found in group ${groupId} to approve.`, count: 0 }, { status: 200 });
                }

                // Set success message and counts for final response
                updateResult = { count: approvedCount }; // Use approvedCount for the primary result
                autoRejectedCount = rejectedCount;
                successMessage = `Successfully approved ${approvedCount} pending requests for group ${groupId}.` + 
                                 (rejectedCount > 0 ? ` Auto-rejected ${rejectedCount} overlapping requests.` : '');
                console.log(`[API Bulk PATCH - Group ${groupId}] Approval finished. Approved: ${approvedCount}, Auto-Rejected: ${rejectedCount}.`);

            } catch (txError) {
                console.error(`[API Bulk Approve TX - Group ${groupId}] Transaction failed:`, txError);
                return NextResponse.json({ error: 'Database transaction failed during approval.' }, { status: 500 });
            }

        } else if (action === 'checkout') {
            // --- Bulk Checkout Logic ---
            console.log(`[API Bulk PATCH - Group ${groupId}] Checking out...`);
            const approvedIds = borrowsToUpdate
                .filter(b => b.borrowStatus === BorrowStatus.APPROVED)
                .map(b => b.id);

            if (approvedIds.length === 0) {
                return NextResponse.json({ message: `No approved items found in group ${groupId} to checkout.`, count: 0 }, { status: 200 });
            }

            updateResult = await prisma.borrow.updateMany({
                where: { id: { in: approvedIds } },
                data: {
                    borrowStatus: BorrowStatus.ACTIVE,
                    checkoutTime: new Date(),
                }
            });
            successMessage = `Successfully checked out ${updateResult.count} approved items in the group.`;
            console.log(`[API Bulk PATCH - Group ${groupId}] Checkout result:`, updateResult);

        } else {
             console.error(`[API PATCH /api/borrows/bulk] Invalid action state for group ${groupId}, action ${action}`);
             return NextResponse.json({ error: 'Invalid state or action for bulk update.' }, { status: 400 });
        }

        // 6. Return Success Response
        return NextResponse.json(
          {
            message: successMessage,
            count: updateResult.count
          },
          { status: 200 }
        );

    } catch (error) {
        console.error(`Bulk update error for group ${groupId} (Action: ${action}):`, error);
        return NextResponse.json({ error: `Failed to perform bulk action (${action}).` }, { status: 500 });
    }
} 
