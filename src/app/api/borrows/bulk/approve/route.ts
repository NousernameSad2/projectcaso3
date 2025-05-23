import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import
import { z } from 'zod';

const prisma = new PrismaClient();

// Define a type for the session user (can be shared)
interface SessionUser {
  id: string;
  role: UserRole;
}

// Define the expected shape of the request body
const bulkActionSchema = z.object({
  borrowGroupId: z.string().min(1).optional(),
  borrowId: z.string().min(1).optional(),
}).refine(data => !!data.borrowGroupId !== !!data.borrowId, {
  message: "Either borrowGroupId OR borrowId must be provided, but not both.",
});

export async function POST(request: Request) {
  // 1. Get User Session and Check Permissions
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized: User session not found.' }, { status: 401 });
  }

  // --- Permission Check (Only Staff/Faculty can approve) ---
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!user.role || !allowedRoles.includes(user.role)) { 
    console.warn(`User ${user.id} with role ${user.role || 'unknown'} attempted a bulk action.`);
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions.' }, { status: 403 });
  }
  // --- End Permission Check --- 

  // 2. Parse and Validate Request Body
  let validatedData;
  try {
    const body = await request.json();
    validatedData = bulkActionSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  const { borrowGroupId, borrowId } = validatedData;

  // 3. Determine approver field based on role
  const approverData = user.role === UserRole.FACULTY 
    ? { approvedByFicId: user.id }
    : { approvedByStaffId: user.id };

  const acceptanceData = {
    acceptedById: user.id,
    acceptedAt: new Date(),
  };

  // 4. Perform the update (single or bulk)
  try {
    let result;
    if (borrowId) {
       // --- Single Item Approval ---
       // Check if the specific borrow exists and is PENDING
       const borrowToApprove = await prisma.borrow.findUnique({
           where: { id: borrowId, borrowStatus: BorrowStatus.PENDING },
           select: { id: true } // Just need to know it exists and matches criteria
       });

       if (!borrowToApprove) {
           // Check if exists at all for better error
           const exists = await prisma.borrow.findUnique({ where: { id: borrowId } });
           if (!exists) return NextResponse.json({ error: `Borrow record ${borrowId} not found.` }, { status: 404 });
           return NextResponse.json({ error: `Borrow record ${borrowId} is not pending approval.` }, { status: 400 });
       }
       
       await prisma.borrow.update({
          where: { id: borrowId },
          data: {
             borrowStatus: BorrowStatus.APPROVED,
             ...approverData,
             ...acceptanceData,
          },
       });
       result = { count: 1 }; // Simulate count for consistency

    } else if (borrowGroupId) {
       // --- Bulk Item Approval --- 
       result = await prisma.borrow.updateMany({
         where: {
           borrowGroupId: borrowGroupId,
           borrowStatus: BorrowStatus.PENDING, 
         },
         data: {
           borrowStatus: BorrowStatus.APPROVED,
           ...approverData,
           ...acceptanceData,
         },
       });
       // Handle bulk count 0 scenario (moved inside)
       if (result.count === 0) {
         const groupExists = await prisma.borrow.findFirst({ where: { borrowGroupId } });
         if (!groupExists) {
           return NextResponse.json({ error: `Borrow group ${borrowGroupId} not found.` }, { status: 404 });
         } else {
           return NextResponse.json({ message: `No pending requests found in group ${borrowGroupId}.`, count: 0 }, { status: 200 });
         }
       }
    } else {
       // Should be caught by refine, but belt-and-suspenders
       return NextResponse.json({ error: 'Invalid request: Missing borrowId or borrowGroupId.' }, { status: 400 });
    }
    
    // 5. Return Success Response (slightly adjusted message)
    const target = borrowId ? `request ${borrowId}` : `group ${borrowGroupId}`;
    return NextResponse.json(
      {
        message: `Successfully approved ${result.count} pending ${borrowId ? 'item' : 'items'} for ${target}.`,
        count: result.count,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error(`Failed to bulk approve requests for group ${borrowGroupId}:`, error);
    return NextResponse.json({ error: 'Database error occurred during bulk approval.' }, { status: 500 });
  }
} 