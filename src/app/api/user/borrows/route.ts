import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Adjust path

const prisma = new PrismaClient();

export async function GET(request: Request) {
  // 1. Get User Session
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // 2. Find all BorrowGroup IDs the user is a member of (using the correct model name)
    const userGroupMemberships = await prisma.borrowGroupMate.findMany({
      where: { userId: userId },
      select: { borrowGroupId: true }
    });
    // Ensure unique group IDs and correct typing
    const userGroupIds: string[] = [...new Set(userGroupMemberships.map((mem: { borrowGroupId: string }) => mem.borrowGroupId))];

    // 3. Fetch User's Borrows (Active or Overdue) based on borrowerId or group membership
    const userBorrows = await prisma.borrow.findMany({
      where: {
        OR: [
          { borrowerId: userId }, // User is the direct borrower
          { 
            // Borrow belongs to a group the user is a member of
            borrowGroupId: { 
              in: userGroupIds, // Check if borrowGroupId is in the list of groups the user belongs to
              not: null // Ensure borrowGroupId is not null (though `in` usually handles this implicitly)
            }
          }
        ],
        // Apply status filter to the combined results
        borrowStatus: {
          // Include PENDING_RETURN status
          in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE, BorrowStatus.PENDING_RETURN],
        },
      },
      include: {
        equipment: { // Include equipment details
          select: { id: true, name: true, equipmentId: true, images: true }, // Added images
        },
        class: { // Include class details
          select: { id: true, courseCode: true, section: true, semester: true }, 
        },
        // No need to include borrowGroup or members here as we filtered by ID
      },
      orderBy: {
        // Order by checkout time, most recent first
        checkoutTime: 'desc',
      },
    });

    // 4. Return the list of borrows
    return NextResponse.json(userBorrows);

  } catch (error) {
    console.error('Failed to fetch user borrows:', error);
    // Provide a more generic error in production, but log specific error
    const message = error instanceof Error ? error.message : 'Database error occurred while fetching borrows.';
    // In development, maybe return the specific error message
    // if (process.env.NODE_ENV === 'development') { 
    //   return NextResponse.json({ error: message }, { status: 500 });
    // } 
    return NextResponse.json({ error: 'An error occurred while fetching your borrows.' }, { status: 500 });
  }
} 