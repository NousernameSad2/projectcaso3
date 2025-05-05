import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole, Prisma, EquipmentStatus } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

interface RouteContext {
  params: {
    borrowId: string; // Use borrowId consistent with folder name
  }
}

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

// Define the type explicitly for clarity
type UpdateBorrowInput = z.infer<typeof UpdateBorrowSchema>;

// PATCH: Update a borrow request (Status OR Details like approved times)
export async function PATCH(req: NextRequest, { params }: RouteContext) {
    const session = await getServerSession(authOptions);
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
                // @ts-ignore
                requestedStartTime: true,
                // @ts-ignore
                requestedEndTime: true 
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
                  // @ts-ignore
                  const approvedStartTime = newStatus === BorrowStatus.APPROVED ? (borrowToUpdate.approvedStartTime || borrowToUpdate.requestedStartTime) : undefined;
                  // @ts-ignore
                  const approvedEndTime = newStatus === BorrowStatus.APPROVED ? (borrowToUpdate.approvedEndTime || borrowToUpdate.requestedEndTime) : undefined;
                  
                  const updateResult = await tx.borrow.update({
                      where: { id: borrowId },
                      data: {
                          borrowStatus: newStatus,
                          approvedStartTime: approvedStartTime,
                          approvedEndTime: approvedEndTime,
                          approvedByFicId: newStatus === BorrowStatus.APPROVED && actorRole === UserRole.FACULTY ? actorId : undefined,
                          approvedByStaffId: newStatus === BorrowStatus.APPROVED && actorRole === UserRole.STAFF ? actorId : undefined,
                      },
                  });

                  // *** NEW: Update Equipment Status on Approval ***
                  if (newStatus === BorrowStatus.APPROVED) {
                      await tx.equipment.update({
                          where: { id: borrowToUpdate.equipmentId }, // Use equipmentId from fetched borrow
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
                              equipmentId: borrowToUpdate.equipmentId,
                              borrowStatus: BorrowStatus.PENDING,
                              id: { not: borrowId }, // Exclude the one just approved
                              AND: [
                                  // @ts-ignore - Ignore type error for requested/approved times
                                  { requestedStartTime: { lt: approvedEndTime } }, // Pending start < Approved end
                                  // @ts-ignore - Ignore type error for requested/approved times
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

    } catch (error: any) {
        console.error(`API Error - PATCH /api/borrows/${borrowId}:`, error);
        if (error.code === 'P2025') { 
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE: Cancel a borrow request (Borrower or Staff/Faculty)
export async function DELETE(req: NextRequest, { params }: RouteContext) {
    // 1. Authenticate the user 
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const userId = session.user.id;
    const userRole = session.user.role as UserRole;
    
    // Access params.borrowId *after* await
    const borrowId = params.borrowId;

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    try {
        // 2. Find the borrow record
        const borrow = await prisma.borrow.findUnique({
            where: { id: borrowId },
            select: { // Select only necessary fields
                borrowerId: true,
                borrowStatus: true,
            }
        });

        if (!borrow) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        // 3. Authorization Check: Allow borrower or Staff/Faculty to cancel
        const isBorrower = borrow.borrowerId === userId;
        const isPrivilegedUser = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;

        if (!isBorrower && !isPrivilegedUser) {
            return NextResponse.json({ message: 'Forbidden: You are not authorized to cancel this request' }, { status: 403 });
        }
        
        // 4. Check if cancellation is allowed based on status
        const allowedCancelStatuses: BorrowStatus[] = [BorrowStatus.PENDING, BorrowStatus.APPROVED];
        if (!allowedCancelStatuses.includes(borrow.borrowStatus)) {
            return NextResponse.json(
                { message: `Cannot cancel request. Status is already ${borrow.borrowStatus}.` }, 
                { status: 409 } // 409 Conflict
             );
        }

        // 5. Update the borrow status to CANCELLED
        const updatedBorrow = await prisma.borrow.update({
            where: { id: borrowId },
            data: {
                borrowStatus: BorrowStatus.CANCELLED,
            },
             select: { id: true, borrowStatus: true } // Return minimal data
        });

        console.log(`User ${session.user.email} cancelled borrow request ${borrowId}`);

        // 6. Return Success Response
        return NextResponse.json(
            { message: "Reservation cancelled successfully.", borrow: updatedBorrow }, 
            { status: 200 }
        );

    } catch (error: any) {
        console.error(`API Error - DELETE /api/borrows/${borrowId}:`, error);
        if (error.code === 'P2025') { // Handle case where record was deleted between find and update
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// Add GET handler if needed to fetch a single borrow record by ID
// export async function GET(req: NextRequest, { params }: RouteContext) { ... }

// Add DELETE handler if needed to cancel/delete a borrow record
// export async function DELETE(req: NextRequest, { params }: RouteContext) { ... } 