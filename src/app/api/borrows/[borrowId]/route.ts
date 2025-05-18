import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole, Prisma, EquipmentStatus } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";

// Define the schema for the expected PATCH request body
const UpdateBorrowSchema = z.object({
  // Option 1: Update Status (Approve/Reject)
  status: z.nativeEnum(BorrowStatus).optional(),
  // Option 2: Update Details (e.g., approved times) for APPROVED records
  approvedStartTime: z.string().datetime({ message: "Invalid start date/time format." }).optional(),
  approvedEndTime: z.string().datetime({ message: "Invalid end date/time format." }).optional(),
  // Add other editable fields here if needed (classId, etc.)
}).refine(data => {
    // If updating times, end must be after start
    if (data.approvedStartTime && data.approvedEndTime) {
        return new Date(data.approvedEndTime) > new Date(data.approvedStartTime);
    }
    return true; // Passthrough if times aren't being updated together
}, {
    message: "Approved end time must be after start time.",
    path: ["approvedEndTime"],
}).refine(data => {
    // Can only update times OR status, not both in one request (for clarity)
    const hasStatus = !!data.status;
    const hasTimes = !!data.approvedStartTime || !!data.approvedEndTime;
    return !(hasStatus && hasTimes);
}, { message: "Cannot update status and approved times simultaneously." });

// PATCH: Update a borrow request (Status OR Details like approved times)
export async function PATCH(req: NextRequest, context: { params: Promise<{borrowId: string}>}) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const { id: actorId, role: actorRole } = session.user as { id: string; role: UserRole };
    
    // Access params.borrowId *after* await
    const borrowId = params.borrowId;

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    try {
        const body = await req.json();
        const parsedData = UpdateBorrowSchema.safeParse(body);

        if (!parsedData.success) {
            return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
        }
        const updatePayload = parsedData.data;
        
        // Fetch the borrow record
        const borrowToUpdate = await prisma.borrow.findUnique({
            where: { id: borrowId },
             select: { 
                borrowStatus: true, 
                equipmentId: true, 
                requestedStartTime: true,
                requestedEndTime: true,
                approvedStartTime: true,
                approvedEndTime: true
            }
        });

        if (!borrowToUpdate) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        // --- Handle Status Update (Approve/Reject) --- 
        if (updatePayload.status) {
             const newStatus = updatePayload.status;
             // Check permissions for status change (STAFF/FACULTY only)
             if (actorRole !== UserRole.STAFF && actorRole !== UserRole.FACULTY) {
                 return NextResponse.json({ message: 'Forbidden: Insufficient role for status update.' }, { status: 403 });
             }
             // Validate status transition (e.g., only approve PENDING)
             if (newStatus === BorrowStatus.APPROVED && borrowToUpdate.borrowStatus !== BorrowStatus.PENDING) {
                 return NextResponse.json({ message: `Cannot approve request with status ${borrowToUpdate.borrowStatus}.` }, { status: 400 });
             }
             // TODO: Add other transition validations (Reject PENDING, etc.)

             const rejectionStatus = actorRole === UserRole.FACULTY ? BorrowStatus.REJECTED_FIC : BorrowStatus.REJECTED_STAFF;

             // Transaction for Approval + Auto-Rejection
             const { updatedBorrow, rejectedCount } = await prisma.$transaction(async (tx) => {
                  // Set approved times only on approval
                  const approvedStartTime = newStatus === BorrowStatus.APPROVED ? (borrowToUpdate.approvedStartTime || borrowToUpdate.requestedStartTime) : undefined;
                  const approvedEndTime = newStatus === BorrowStatus.APPROVED ? (borrowToUpdate.approvedEndTime || borrowToUpdate.requestedEndTime) : undefined;
                  
                  const updateData: Prisma.BorrowUpdateInput = {
                      borrowStatus: newStatus,
                      approvedStartTime: approvedStartTime,
                      approvedEndTime: approvedEndTime,
                  };

                  // Clear any existing approver/rejecter relations first, then set the new one if applicable.
                  updateData.approvedByFic = { disconnect: true };
                  updateData.approvedByStaff = { disconnect: true };

                  if (newStatus === BorrowStatus.APPROVED) {
                      if (actorRole === UserRole.FACULTY) {
                          updateData.approvedByFic = { connect: { id: actorId } };
                      } else if (actorRole === UserRole.STAFF) {
                          updateData.approvedByStaff = { connect: { id: actorId } };
                      }
                  } else if (newStatus === BorrowStatus.REJECTED_STAFF) {
                      updateData.approvedByStaff = { connect: { id: actorId } };
                      // approvedByFic is already disconnected
                  } else if (newStatus === BorrowStatus.REJECTED_FIC) {
                      updateData.approvedByFic = { connect: { id: actorId } };
                      // approvedByStaff is already disconnected
                  }
                  // For any other status, both remain disconnected (cleared).
                                    
                  const updateResult = await tx.borrow.update({
                      where: { id: borrowId },
                      data: updateData,
                  });

                  // *** NEW: Update Equipment Status on Approval ***
                  if (newStatus === BorrowStatus.APPROVED) {
                      await tx.equipment.update({
                          where: { id: borrowToUpdate.equipmentId as string }, // CAST to string
                          data: { status: EquipmentStatus.RESERVED }, // Set to RESERVED
                      });
                       console.log(`[API PATCH /borrows/${borrowId}] Updated equipment ${borrowToUpdate.equipmentId} status to RESERVED.`);
                  }
                  // *** END NEW ***

                  let rejCount = 0;
                  if (newStatus === BorrowStatus.APPROVED && approvedStartTime && approvedEndTime) {
                      // Find and reject overlapping pending
                      const overlappingPending = await tx.borrow.findMany({
                          where: {
                              equipmentId: borrowToUpdate.equipmentId as string, // CAST to string
                              borrowStatus: BorrowStatus.PENDING,
                              id: { not: borrowId }, // Exclude the one just approved
                              AND: [
                                  { requestedStartTime: { lt: approvedEndTime } }, // Pending start < Approved end
                                  { requestedEndTime: { gt: approvedStartTime } }  // Pending end > Approved start
                              ]
                          },
                          select: { id: true } // Only need IDs
                      });
                      const overlappingIds = overlappingPending.map(b => b.id);
                      if (overlappingIds.length > 0) {
                          const rejectResult = await tx.borrow.updateMany({
                              where: {
                                  id: { in: overlappingIds }
                              },
                              data: {
                                  borrowStatus: rejectionStatus // Use role-based rejection status
                              }
                          });
                          rejCount = rejectResult.count;
                      }
                  }
                  return { updatedBorrow: updateResult, rejectedCount: rejCount };
             });

            return NextResponse.json({ 
                message: `Reservation status updated to ${newStatus}. ${rejectedCount > 0 ? `${rejectedCount} overlapping requests rejected.` : ''}`, 
                borrow: updatedBorrow 
            }, { status: 200 });
        }

        // --- Handle Detail Update (e.g., Approved Times) --- 
        else if (updatePayload.approvedStartTime || updatePayload.approvedEndTime) {
            // Check permissions (STAFF/FACULTY?)
            if (actorRole !== UserRole.STAFF && actorRole !== UserRole.FACULTY) {
                 return NextResponse.json({ message: 'Forbidden: Insufficient role for detail update.' }, { status: 403 });
            }
            // Can only edit details if status is APPROVED
            if (borrowToUpdate.borrowStatus !== BorrowStatus.APPROVED) {
                 return NextResponse.json({ message: 'Cannot edit details unless reservation is already approved.' }, { status: 400 });
            }

            // Prepare update data - only include fields that were actually sent
            const detailUpdateData: Prisma.BorrowUpdateInput = {};
            if (updatePayload.approvedStartTime) {
                detailUpdateData.approvedStartTime = new Date(updatePayload.approvedStartTime);
            }
            if (updatePayload.approvedEndTime) {
                detailUpdateData.approvedEndTime = new Date(updatePayload.approvedEndTime);
            }
            // Add other editable fields here

            // Perform the update
            const updatedBorrow = await prisma.borrow.update({
                where: { id: borrowId },
                data: detailUpdateData,
            });

            // TODO: After updating times, should we re-run the auto-rejection logic 
            // for PENDING requests that might NOW overlap with the new approved times?
            // This adds complexity.

            console.log(`User ${actorId} updated details for borrow ${borrowId}`);
            return NextResponse.json({ message: "Reservation details updated successfully.", borrow: updatedBorrow });
        }

        // If neither status nor details were provided (should be caught by schema?)
        return NextResponse.json({ message: 'No valid update operation specified.' }, { status: 400 });

    } catch (error: unknown) {
        console.log(`[API PATCH /borrows/${borrowId}] Error updating borrow:`, error);
        // Improved error handling to provide more specific messages if possible
        let errorMessage = "An internal server error occurred.";
        let statusCode = 500;

        if (error instanceof z.ZodError) {
            errorMessage = "Invalid input provided.";
            statusCode = 400;
            // Optional: include error.flatten() for more details in response
        } else if (error instanceof Error) {
            errorMessage = error.message; // Use the specific error message
            // Set status code based on error message content if needed
            if (error.message.toLowerCase().includes("not found")) {
                statusCode = 404;
            } else if (error.message.toLowerCase().includes("forbidden")) {
                statusCode = 403;
            } else if (error.message.toLowerCase().includes("cannot update status")) {
                 statusCode = 400; // Or 409 Conflict
            }
        }
        
        return NextResponse.json({ message: errorMessage }, { status: statusCode });
    }
}

// DELETE: Cancel a PENDING borrow request
export async function DELETE(req: NextRequest, context: { params: Promise<{ borrowId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const { id: actorId, role: actorRole } = session.user as { id: string; role: UserRole };

    const borrowId = params.borrowId;
    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    try {
        const borrowToDelete = await prisma.borrow.findUnique({
            where: { id: borrowId },
            select: { 
                borrowStatus: true, 
                borrowerId: true, // For permission check
                equipmentId: true, 
                borrowGroupId: true // For group cancellation logic
            }
        });

        if (!borrowToDelete) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        // Permission Check:
        // 1. User can cancel their own PENDING request.
        // 2. STAFF/FACULTY can cancel any PENDING request.
        const isOwner = borrowToDelete.borrowerId === actorId;
        const isAdminRole = actorRole === UserRole.STAFF || actorRole === UserRole.FACULTY;

        if (borrowToDelete.borrowStatus !== BorrowStatus.PENDING) {
            return NextResponse.json({ message: 'Can only cancel PENDING requests.' }, { status: 400 });
        }

        if (!isOwner && !isAdminRole) {
            return NextResponse.json({ message: 'Forbidden: You do not have permission to cancel this request.' }, { status: 403 });
        }

        // If it's a group borrow and the user is admin, they might intend to cancel the whole group
        // For simplicity, this DELETE targets only the specific borrowId.
        // Group cancellation could be a separate endpoint or logic if needed.

        // --- Transaction for Deletion + Equipment Status Update ---
        await prisma.$transaction(async (tx) => {
            await tx.borrow.delete({
                where: { id: borrowId },
            });
            console.log(`[API DELETE /borrows/${borrowId}] Borrow record deleted by ${actorId} (${actorRole}).`);

            // Check if the equipment should become AVAILABLE
            const remainingBorrowsForEquipment = await tx.borrow.count({
                where: {
                    equipmentId: borrowToDelete.equipmentId as string, // CAST to string
                    // Consider only statuses that make equipment unavailable
                    borrowStatus: { in: [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.PENDING_RETURN] }
                }
            });

            if (remainingBorrowsForEquipment === 0) {
                // Check current status before blindly updating
                const equipment = await tx.equipment.findUnique({ where: { id: borrowToDelete.equipmentId as string }, select: { status: true }}); // CAST to string
                if (equipment && equipment.status === EquipmentStatus.RESERVED) { // Only if it was RESERVED
                    await tx.equipment.update({
                        where: { id: borrowToDelete.equipmentId as string }, // CAST to string
                        data: { status: EquipmentStatus.AVAILABLE },
                    });
                    console.log(`[API DELETE /borrows/${borrowId}] Equipment ${borrowToDelete.equipmentId} status updated to AVAILABLE.`);
                }
            }
        });
        // --- End Transaction ---

        return NextResponse.json({ message: 'Borrow request cancelled successfully.' }, { status: 200 });

    } catch (error: unknown) { // CHANGED any to unknown
        console.error(`[API DELETE /borrows/${borrowId}] Error cancelling borrow:`, error);
        const message = error instanceof Error ? error.message : "An internal server error occurred while cancelling the request.";
        return NextResponse.json({ message }, { status: 500 });
    }
}

// Add GET handler if needed to fetch a single borrow record by ID
// export async function GET(req: NextRequest, { params }: RouteContext) { ... }

// Add DELETE handler if needed to cancel/delete a borrow record
// export async function DELETE(req: NextRequest, { params }: RouteContext) { ... } 