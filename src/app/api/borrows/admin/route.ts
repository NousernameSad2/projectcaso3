import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

// REMOVED SessionUser interface

export async function GET() { // REMOVED _request: Request
  // 1. Get User Session and Check Permissions
  const session = await getServerSession(authOptions);
  // Use optional chaining and nullish coalescing for safety
  const userRole = session?.user?.role as UserRole | undefined;
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized: User session not found.' }, { status: 401 });
  }

  // --- Permission Check --- 
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!userRole || !allowedRoles.includes(userRole)) { 
    console.warn(`User ${userId} with role ${userRole || 'unknown'} attempted to access admin borrow list.`);
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions.' }, { status: 403 });
  }
  // --- End Permission Check --- 

  // 2. Fetch All Borrow Requests with related data
  try {
    const borrowRequests = await prisma.borrow.findMany({
      include: {
        borrower: { // Include borrower details
          select: { id: true, name: true, email: true }, // Select specific fields
        },
        equipment: { // Include equipment details
          select: { id: true, name: true, equipmentId: true }, // Select specific fields
        },
        class: { // Include class details
          select: { id: true, courseCode: true, section: true, semester: true, academicYear: true }, // Select specific fields
        },
        // Optionally include approvers if needed later
        // approvedByFic: { select: { id: true, name: true } },
        // approvedByStaff: { select: { id: true, name: true } },
      },
      orderBy: [
        { requestSubmissionTime: 'asc' },
      ],
      // TODO: Add filtering capabilities via URL search params (e.g., status, date range)
    });

    // 3. Return the list of borrow requests
    return NextResponse.json(borrowRequests);

  } catch (error) {
    console.error('Failed to fetch borrow requests for admin:', error);
    return NextResponse.json({ error: 'Database error occurred while fetching borrow requests.' }, { status: 500 });
  }
} 