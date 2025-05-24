import { NextRequest, NextResponse } from 'next/server';
import { z } from "zod";
import { Prisma, UserRole, ReservationType, BorrowStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import { createId } from '@paralleldrive/cuid2'; 
import { formatInTimeZone } from 'date-fns-tz';
// Remove date-fns imports if no longer needed for calculation
// import { startOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

// Define validation schema for bulk borrow request
const bulkBorrowSchema = z.object({
  equipmentIds: z.array(z.string().min(1)).min(1, "At least one equipment ID is required"),
  classId: z.string().nullable().optional(), // MODIFIED: Allow null, undefined, or a string
  requestedStartTime: z.string().datetime({ message: "Invalid start date/time format." }),
  requestedEndTime: z.string().datetime({ message: "Invalid end date/time format." }),
  groupMateIds: z.array(z.string().min(1)).optional(),
  reservationType: z.nativeEnum(ReservationType).optional(), // Added optional reservation type
}).refine((data) => new Date(data.requestedEndTime) > new Date(data.requestedStartTime), {
  message: "End time must be after start time.",
  path: ["requestedEndTime"],
});

type BulkBorrowInput = z.infer<typeof bulkBorrowSchema>;

export async function POST(request: Request) {
  // 1. Get User Session
  const session = await getServerSession(authOptions); 
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id; 
  
  // 2. Parse and Validate Request Body
  let validatedData: BulkBorrowInput;
  try {
    const body = await request.json();
    validatedData = bulkBorrowSchema.parse(body);
  } catch (error) {
     if (error instanceof z.ZodError) {
         return NextResponse.json({ error: 'Invalid input', details: error.flatten() }, { status: 400 });
     }
     return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  const {
    equipmentIds,
    classId,
    requestedStartTime: requestedStartTimeStr, // Renaming to avoid confusion with Date object
    requestedEndTime: requestedEndTimeStr,     // Renaming to avoid confusion with Date object
    groupMateIds,
    reservationType
  } = validatedData;

  const requestedStartTime = new Date(requestedStartTimeStr);
  const requestedEndTime = new Date(requestedEndTimeStr);
  const facilityTimeZone = 'Asia/Manila';

  // Optional: Add detailed logging similar to the other route if needed for debugging
  console.log(`[BULK API] Original Start: ${requestedStartTimeStr}, Parsed UTC: ${requestedStartTime.toISOString()}`);
  console.log(`[BULK API] Original End: ${requestedEndTimeStr}, Parsed UTC: ${requestedEndTime.toISOString()}`);

  // --- START: Validate Reservation Time Window (Philippine Time) ---  
  const startHourPHT = parseInt(formatInTimeZone(requestedStartTime, facilityTimeZone, 'H'), 10);
  const endHourPHT = parseInt(formatInTimeZone(requestedEndTime, facilityTimeZone, 'H'), 10);

  console.log(`[BULK API] Start Hour (${facilityTimeZone}):`, startHourPHT, `End Hour (${facilityTimeZone}):`, endHourPHT);

  if (startHourPHT < 6 || startHourPHT >= 20 || endHourPHT < 6 || endHourPHT >= 20) {
    return NextResponse.json({ message: 'Reservations must be between 6:00 AM and 8:00 PM Philippine Time.' }, { status: 400 });
  }
  // --- END: Validate Reservation Time Window --- 

  // Use requestedStartTime and requestedEndTime (which are Date objects) for further logic like overlap checks
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

      // Use converted requestedStartTime and requestedEndTime for overlap check
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
                           { approvedEndTime: null, requestedStartTime: { gt: requestedStartTime } } 
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

  // 4. Prepare data for batch creation
  const borrowData = equipmentIds.map((equipmentId) => ({
    borrowGroupId: borrowGroupId,
    borrowerId: userId,
    equipmentId: equipmentId,
    classId: classId || null, // Use null if classId is undefined/empty
    requestedStartTime: requestedStartTime, 
    requestedEndTime: requestedEndTime,   
    borrowStatus: BorrowStatus.PENDING,
    reservationType: reservationType, // Add reservationType to the data
  }));

  // 5. Create Borrow Records in Batch (and Group Mates if provided)
  try {
    // *** START NEW: Use Prisma Transaction ***
    const transactionResult = await prisma.$transaction(async (tx) => {
        // 5a. Create Borrow Records
        const borrowResult = await tx.borrow.createMany({
          data: borrowData,
        });

        if (borrowResult.count !== equipmentIds.length) {
            console.warn(`Bulk borrow creation for group ${borrowGroupId}: Expected ${equipmentIds.length} records, created ${borrowResult.count}. Rolling back transaction.`);
            // Throw an error to automatically roll back the transaction
            throw new Error(`Borrow creation count mismatch: Expected ${equipmentIds.length}, created ${borrowResult.count}.`);
        }

        // 5b. *** NEW: Update Equipment Status to RESERVED ***
        // Update status only for AVAILABLE equipment being reserved
        // const updateEquipmentStatus = await tx.equipment.updateMany({
        //     where: {
        //         id: { in: equipmentIds },
        //         status: EquipmentStatus.AVAILABLE, // Only update if currently available
        //         // Add stock check? Maybe not needed here as availability check was done before.
        //     },
        //     data: {
        //         status: EquipmentStatus.RESERVED,
        //     },
        // });
        // console.log(`[API Bulk POST - Group ${borrowGroupId}] Updated status to RESERVED for ${updateEquipmentStatus.count} equipment items.`);
        // Note: It's possible updateEquipmentStatus.count is less than borrowResult.count
        // if some equipment was already RESERVED/BORROWED (though pre-check should prevent this)
        // or if multiple borrow requests targeted the same equipment item within this bulk request.
        // This is generally acceptable as long as *at least one* borrow forces the RESERVED status.

        // 5c. If groupMateIds were provided, create BorrowGroupMate entries
        let groupMateResultCount = 0;
        if (groupMateIds && groupMateIds.length > 0) {
            const allMemberIds = Array.from(new Set([userId, ...groupMateIds])); 
            
            const groupMateData = allMemberIds.map(mateId => ({
                borrowGroupId: borrowGroupId,
                userId: mateId,
            }));

            const groupMateResult = await tx.borrowGroupMate.createMany({
                data: groupMateData
            });
            groupMateResultCount = groupMateResult.count;
            console.log(`Added ${groupMateResultCount} members to borrow group ${borrowGroupId}.`);
        }

        // Return results from transaction
        return { borrowCount: borrowResult.count, groupMemberCount: groupMateResultCount };
    }); // *** END NEW: Prisma Transaction ***


    // 6. Return Success Response using results from transaction
    return NextResponse.json(
      {
        message: `${transactionResult.borrowCount} borrow requests created successfully for group ${borrowGroupId}. ${transactionResult.groupMemberCount > 0 ? ` ${transactionResult.groupMemberCount} members associated.` : ''}`,
        borrowGroupId: borrowGroupId,
        borrowCount: transactionResult.borrowCount,
        groupMemberCount: transactionResult.groupMemberCount
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

    const validActions = ['checkout', 'approve'];
    if (!action || !validActions.includes(action)) { 
        return NextResponse.json({ error: `Invalid or missing action specified. Valid actions: ${validActions.join(', ')}` }, { status: 400 });
    }

    try {
        const borrowsToUpdate = await prisma.borrow.findMany({
            where: { borrowGroupId: groupId },
            select: { id: true, borrowStatus: true, equipmentId: true } 
        });

        if (borrowsToUpdate.length === 0) {
            return NextResponse.json({ error: `No borrows found for group ${groupId}` }, { status: 404 });
        }

        let updateResult: Prisma.BatchPayload = { count: 0 }; 
        let successMessage = ''; 
        let autoRejectedCount = 0; 

        if (action === 'approve') {
            console.log(`[API Bulk PATCH - Group ${groupId}] Approving with auto-rejection...`);
            try {
                const { approvedCount, rejectedCount } = await prisma.$transaction(async (tx) => {
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
                        console.log(`[API Bulk PATCH - Group ${groupId}] No PENDING borrows to approve.`);
                        return { approvedCount: 0, rejectedCount: 0 };
                    }
                    
                    const equipmentIdsToApprove = borrowsToApprove.map(b => b.equipmentId);
                    const borrowIdsToApprove = borrowsToApprove.map(b => b.id);

                    const approvedResult = await tx.borrow.updateMany({
                        where: { id: { in: borrowIdsToApprove } },
                        data: {
                            borrowStatus: BorrowStatus.APPROVED,
                            approvedByFicId: userRole === UserRole.FACULTY ? actorId : null,
                            approvedByStaffId: userRole === UserRole.STAFF ? actorId : null,
                            approvedStartTime: borrowsToApprove[0]?.requestedStartTime, 
                            approvedEndTime: borrowsToApprove[0]?.requestedEndTime,   
                        },
                    });
                    
                    let autoRejectedCountTx = 0; 
                    if (approvedResult.count > 0 && borrowsToApprove.length > 0) {
                        const approvedStartTime = borrowsToApprove[0].requestedStartTime; 
                        const approvedEndTime = borrowsToApprove[0].requestedEndTime;   

                        const overlappingPendingBorrows = await tx.borrow.findMany({
                            where: {
                                NOT: {
                                    id: { in: borrowIdsToApprove }
                                },
                                equipmentId: { in: equipmentIdsToApprove.filter((id): id is string => id !== null) }, // Filter nulls here
                                borrowStatus: BorrowStatus.PENDING,
                                requestedStartTime: { lt: approvedEndTime }, 
                                requestedEndTime: { gt: approvedStartTime },
                            },
                            select: { id: true }
                        });

                        if (overlappingPendingBorrows.length > 0) {
                            const idsToReject = overlappingPendingBorrows.map(b => b.id);
                            const rejectionResult = await tx.borrow.updateMany({
                                where: { id: { in: idsToReject } },
                                data: {
                                    borrowStatus: BorrowStatus.REJECTED_AUTOMATIC,
                                }
                            });
                            autoRejectedCountTx = rejectionResult.count;
                            console.log(`[API Bulk PATCH - Group ${groupId}] Auto-rejected ${autoRejectedCountTx} conflicting PENDING reservations using REJECTED_AUTOMATIC.`);
                        }
                    }
                    
                    return { approvedCount: approvedResult.count, rejectedCount: autoRejectedCountTx };
                });

                updateResult = { count: approvedCount }; 
                autoRejectedCount = rejectedCount;

                console.log(`[API Bulk PATCH - Group ${groupId}] Transaction complete: Approved: ${approvedCount}, Auto-Rejected: ${autoRejectedCount}`);
                successMessage = `Successfully approved ${approvedCount} reservation(s).`;
                if (autoRejectedCount > 0) {
                    successMessage += ` ${autoRejectedCount} conflicting reservation(s) were automatically rejected.`;
                }

            } catch (txError) {
                console.error(`[API Bulk PATCH - Group ${groupId}] Transaction failed during approval:`, txError);
                 throw new Error('Transaction failed during bulk approval.');
            }
        } else if (action === 'checkout') {
            console.log(`[API Bulk PATCH - Group ${groupId}] Checking out...`);

            const approvedBorrows = borrowsToUpdate.filter(b => b.borrowStatus === BorrowStatus.APPROVED);
            const borrowIdsToCheckOut = approvedBorrows.map(b => b.id);
            // const equipmentIdsToCheckOut = approvedBorrows.map(b => b.equipmentId); // This line was present but equipmentIdsToCheckOut is not used

            if (borrowIdsToCheckOut.length === 0) {
                return NextResponse.json({ message: `No approved borrows found in group ${groupId} to checkout.` }, { status: 400 });
            }

            try {
                updateResult = await prisma.$transaction(async (tx) => {
                    const checkoutUpdate = await tx.borrow.updateMany({
                        where: { id: { in: borrowIdsToCheckOut } },
                        data: {
                            borrowStatus: BorrowStatus.ACTIVE,
                            checkoutTime: new Date(), 
                        },
                    });
                    return checkoutUpdate;
                });
            } catch (txError) {
                console.error(`[API Bulk PATCH - Group ${groupId}] Transaction failed during checkout:`, txError);
                throw new Error('Transaction failed during bulk checkout.');
            }

            successMessage = `Successfully checked out ${updateResult.count} item(s) for group ${groupId}.`;
            console.log(`[API Bulk PATCH - Group ${groupId}] Checkout transaction complete: ${updateResult.count} items updated.`);
        }
        else {
             console.error(`[API PATCH /api/borrows/bulk] Invalid action '${action || ''}' reached processing block for group ${groupId}.`); // Safely access action
             return NextResponse.json({ error: 'Internal server error: Invalid action processed.' }, { status: 500 });
        }

        console.log(`[API Bulk PATCH - Group ${groupId}] Action '${action || ''}' completed. Count: ${updateResult.count}`); // Safely access action
        return NextResponse.json({ 
            message: successMessage, 
            count: updateResult.count 
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        console.error(`[API Bulk PATCH - Group ${groupId}] Error during bulk action '${action || ''}':`, error); // Safely access action
        return NextResponse.json({ error: message }, { status: 500 });
    }
} 
