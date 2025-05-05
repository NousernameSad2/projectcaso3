import { NextResponse, NextRequest } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole, EquipmentStatus, Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const prisma = new PrismaClient();

// Define RouteContext using borrowId
interface RouteContext {
  params: {
    borrowId: string; // This will actually contain the borrowGroupId from the URL
  };
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  const userRole = session?.user?.role as UserRole;
  const userId = session?.user?.id;

  // 1. Authentication and Authorization
  if (!session || !userId || !(userRole === UserRole.STAFF || userRole === UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  // Use params.borrowId as the borrowGroupId
  const borrowGroupId = params.borrowId; 

  if (!borrowGroupId) {
    // Changed error message slightly for clarity
    return NextResponse.json({ message: 'Borrow Group ID (from URL borrowId segment) is missing' }, { status: 400 });
  }

  try {
    // Determine the rejection status based on user role
    const rejectionStatus = userRole === UserRole.FACULTY ? BorrowStatus.REJECTED_FIC : BorrowStatus.REJECTED_STAFF;

    // --- Use a Transaction --- 
    const transactionResult = await prisma.$transaction(async (tx) => {
        // 2. Find borrows in the group that are currently APPROVED
        const borrowsToReject = await tx.borrow.findMany({
            where: {
                borrowGroupId: borrowGroupId,
                borrowStatus: BorrowStatus.APPROVED, 
            },
            select: {
                id: true, 
                equipmentId: true // <-- Select equipmentId
            },
        });

        if (borrowsToReject.length === 0) {
            // Throw an error to rollback transaction if no borrows found
            throw new Error('No approved requests found for this group ID to reject.'); 
        }

        const borrowIdsToReject = borrowsToReject.map(b => b.id);
        const equipmentIdsToUpdate = [...new Set(borrowsToReject.map(b => b.equipmentId))]; // Get unique equipment IDs

        // 3. Update the status of these borrows to the determined rejection status
        const updateBorrowsResult = await tx.borrow.updateMany({
            where: {
                id: { in: borrowIdsToReject },
            },
            data: {
                borrowStatus: rejectionStatus,
                approvedStartTime: null, // <<< Also clear approval times
                approvedEndTime: null,   // <<< Also clear approval times
                approvedByFicId: null,
                approvedByStaffId: null,
            },
        });

        // 4. Update the status of associated equipment to AVAILABLE
        // IMPORTANT: This assumes rejecting makes it immediately available.
        // A more complex check might be needed if other reservations exist.
        const updateEquipmentResult = await tx.equipment.updateMany({
            where: {
                id: { in: equipmentIdsToUpdate },
                // Optional: Only update if status is RESERVED?
                // status: EquipmentStatus.RESERVED 
            },
            data: {
                status: EquipmentStatus.AVAILABLE,
            }
        });

        console.log(`[Reject Approved Group TX] User ${userId} (${userRole}) rejected ${updateBorrowsResult.count} borrows for group ${borrowGroupId}.`);
        console.log(`[Reject Approved Group TX] Updated ${updateEquipmentResult.count} equipment statuses to AVAILABLE for IDs: ${equipmentIdsToUpdate.join(', ')}`);
        
        return { count: updateBorrowsResult.count };
    });
    // --- End Transaction --- 

    return NextResponse.json({
      message: `Successfully rejected ${transactionResult.count} approved item(s) in the group and updated equipment status.`,
      rejectedCount: transactionResult.count,
    }, { status: 200 });

  } catch (error) {
    // Update log message to reflect the route path change
    console.error(`[API Error] PATCH /api/borrows/${borrowGroupId}/reject-approved:`, error); 
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ message: `Failed to reject approved group: ${message}` }, { status: 500 });
  }
} 