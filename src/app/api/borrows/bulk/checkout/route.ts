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

  // --- Permission Check (Only Staff can checkout) ---
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY]; // Assuming only STAFF can confirm checkout
  if (!user.role || !allowedRoles.includes(user.role)) {
    console.warn(`User ${user.id} with role ${user.role || 'unknown'} attempted a bulk checkout action.`);
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
  const checkoutTimestamp = new Date(); // Record the checkout time

  // 3. Perform the update (single or bulk)
  try {
    let result;

    if (borrowId) {
       // --- Single Item Checkout ---
       // Check if the specific borrow exists and is APPROVED
       const borrowToCheckout = await prisma.borrow.findUnique({
           where: { id: borrowId, borrowStatus: BorrowStatus.APPROVED },
           // Select approvedEndTime to determine if it should be active or overdue
           select: { id: true, approvedEndTime: true } 
       });

       if (!borrowToCheckout) {
           const exists = await prisma.borrow.findUnique({ where: { id: borrowId }, select: { borrowStatus: true } });
           if (!exists) return NextResponse.json({ error: `Borrow record ${borrowId} not found.` }, { status: 404 });
           return NextResponse.json({ error: `Borrow record ${borrowId} is not approved for checkout (Status: ${exists.borrowStatus}).` }, { status: 400 });
       }

       let newStatus: BorrowStatus = BorrowStatus.ACTIVE;
       if (borrowToCheckout.approvedEndTime && new Date(borrowToCheckout.approvedEndTime) < checkoutTimestamp) {
           newStatus = BorrowStatus.OVERDUE;
       }

       await prisma.borrow.update({
          where: { id: borrowId },
          data: {
              borrowStatus: newStatus,
              checkoutTime: checkoutTimestamp,
              approvedByStaffId: user.id, // Record who confirmed the checkout
          },
       });
       result = { count: 1 }; // Simulate count for consistency

    } else if (borrowGroupId) {
       // --- Bulk Item Checkout ---
       // For bulk, we currently set all to ACTIVE. 
       // A more complex approach would be needed to set ACTIVE/OVERDUE individually.
       result = await prisma.borrow.updateMany({
         where: {
           borrowGroupId: borrowGroupId,
           borrowStatus: BorrowStatus.APPROVED, // Only checkout items that are approved
         },
         data: {
             borrowStatus: BorrowStatus.ACTIVE, // Explicitly set to ACTIVE for now
             checkoutTime: checkoutTimestamp,
             approvedByStaffId: user.id, // Record who confirmed the checkout
         },
       });

       // Handle bulk count 0 scenario
       if (result.count === 0) {
         const groupExists = await prisma.borrow.findFirst({ where: { borrowGroupId } });
         if (!groupExists) {
           return NextResponse.json({ error: `Borrow group ${borrowGroupId} not found.` }, { status: 404 });
         } else {
             // Check if any are actually approved in the group
             const anyApproved = await prisma.borrow.findFirst({ where: { borrowGroupId, borrowStatus: BorrowStatus.APPROVED }});
             if (!anyApproved) {
                 return NextResponse.json({ message: `No approved requests found in group ${borrowGroupId} awaiting checkout.`, count: 0 }, { status: 200 });
             }
           return NextResponse.json({ message: `Something went wrong, 0 items updated in group ${borrowGroupId}.`, count: 0 }, { status: 200 }); // Generic message if some were approved but 0 updated
         }
       }
    } else {
       // Should be caught by refine
       return NextResponse.json({ error: 'Invalid request: Missing borrowId or borrowGroupId.' }, { status: 400 });
    }

    // 4. Return Success Response
    const target = borrowId ? `request ${borrowId}` : `group ${borrowGroupId}`;
    return NextResponse.json(
      {
        message: `Successfully checked out ${result.count} ${borrowId ? 'item' : 'approved items'} for ${target}.`,
        count: result.count,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error(`Failed to bulk checkout requests for ${borrowGroupId || borrowId}:`, error);
    return NextResponse.json({ error: 'Database error occurred during bulk checkout.' }, { status: 500 });
  }
} 