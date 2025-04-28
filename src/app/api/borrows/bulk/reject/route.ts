import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Adjust path if needed
import { z } from 'zod';

const prisma = new PrismaClient();

// Define a type for the session user
interface SessionUser {
  id: string;
  role: UserRole;
}

// Define the expected shape of the request body
const bulkActionSchema = z.object({
  borrowGroupId: z.string().min(1).optional(), // Make optional
  borrowId: z.string().min(1).optional(), // Add optional borrowId
  // Optional: Add rejectionReason field later?
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

  // --- Permission Check (Only Staff/Faculty can reject) ---
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!user.role || !allowedRoles.includes(user.role)) { 
    console.warn(`User ${user.id} with role ${user.role || 'unknown'} attempted a bulk reject action.`);
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions.' }, { status: 403 });
  }
  // --- End Permission Check --- 

  // 2. Parse and Validate Request Body
  let validatedData;
  try {
    const body = await request.json();
    validatedData = bulkActionSchema.parse(body);
    // TODO: Validate rejectionReason if added
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  const { borrowGroupId, borrowId } = validatedData;

  // 3. Determine rejection status based on role
  const rejectionStatus = user.role === UserRole.FACULTY 
    ? BorrowStatus.REJECTED_FIC
    : BorrowStatus.REJECTED_STAFF;

  // 4. Perform the update (single or bulk)
  try {
    let result;
    if (borrowId) {
       // --- Single Item Rejection ---
       const borrowToReject = await prisma.borrow.findUnique({
           where: { id: borrowId, borrowStatus: BorrowStatus.PENDING },
           select: { id: true }
       });

       if (!borrowToReject) {
           const exists = await prisma.borrow.findUnique({ where: { id: borrowId } });
           if (!exists) return NextResponse.json({ error: `Borrow record ${borrowId} not found.` }, { status: 404 });
           return NextResponse.json({ error: `Borrow record ${borrowId} is not pending rejection.` }, { status: 400 });
       }
       
       await prisma.borrow.update({
          where: { id: borrowId },
          data: { borrowStatus: rejectionStatus },
       });
       result = { count: 1 }; 

    } else if (borrowGroupId) {
       // --- Bulk Item Rejection --- 
       result = await prisma.borrow.updateMany({
         where: {
           // @ts-ignore // TODO: Remove after running prisma generate
           borrowGroupId: borrowGroupId,
           borrowStatus: BorrowStatus.PENDING,
         },
         data: { borrowStatus: rejectionStatus },
       });
       // Handle bulk count 0 scenario
       if (result.count === 0) {
         // @ts-ignore // TODO: Remove after running prisma generate
         const groupExists = await prisma.borrow.findFirst({ where: { borrowGroupId } });
         if (!groupExists) {
           return NextResponse.json({ error: `Borrow group ${borrowGroupId} not found.` }, { status: 404 });
         } else {
           return NextResponse.json({ message: `No pending requests found in group ${borrowGroupId}.`, count: 0 }, { status: 200 });
         }
       }
    } else {
       return NextResponse.json({ error: 'Invalid request: Missing borrowId or borrowGroupId.' }, { status: 400 });
    }
    
    // 5. Return Success Response 
    const target = borrowId ? `request ${borrowId}` : `group ${borrowGroupId}`;
    return NextResponse.json(
      {
        message: `Successfully rejected ${result.count} pending ${borrowId ? 'item' : 'items'} for ${target}.`,
        count: result.count,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error(`Failed to bulk reject requests for group ${borrowGroupId}:`, error);
    return NextResponse.json({ error: 'Database error occurred during bulk rejection.' }, { status: 500 });
  }
} 