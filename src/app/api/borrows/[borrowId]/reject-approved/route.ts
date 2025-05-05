import { NextResponse, NextRequest } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole } from '@prisma/client';
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

    // 2. Find borrows in the group that are currently APPROVED
    const borrowsToReject = await prisma.borrow.findMany({
      where: {
        borrowGroupId: borrowGroupId, // Use the variable holding the group ID
        borrowStatus: BorrowStatus.APPROVED, 
      },
      select: {
        id: true, 
      },
    });

    if (borrowsToReject.length === 0) {
      return NextResponse.json({ message: 'No approved requests found for this group ID to reject.' }, { status: 404 });
    }

    const borrowIdsToReject = borrowsToReject.map(b => b.id);

    // 3. Update the status of these borrows to the determined rejection status
    const updateResult = await prisma.borrow.updateMany({
      where: {
        id: { in: borrowIdsToReject },
      },
      data: {
        borrowStatus: rejectionStatus,
        approvedByFicId: null,
        approvedByStaffId: null,
        // Optionally add rejection details
        // rejectedById: userId, 
        // rejectedTime: new Date(),
      },
    });

    console.log(`[Reject Approved Group] User ${userId} (${userRole}) rejected ${updateResult.count} approved borrows for group ${borrowGroupId}.`);

    return NextResponse.json({
      message: `Successfully rejected ${updateResult.count} approved item(s) in the group.`,
      rejectedCount: updateResult.count,
    }, { status: 200 });

  } catch (error) {
    // Update log message to reflect the route path change
    console.error(`[API Error] PATCH /api/borrows/${borrowGroupId}/reject-approved:`, error); 
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ message: `Failed to reject approved group: ${message}` }, { status: 500 });
  }
} 