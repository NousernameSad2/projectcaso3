import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole, EquipmentStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import
import { z } from 'zod';

const prisma = new PrismaClient();

// Define a type for the session user
interface SessionUser {
  id: string;
  role: UserRole;
}

// Define the expected shape of the request body
const bulkActionSchema = z.object({
  borrowGroupId: z.string().min(1, 'borrowGroupId is required'),
});

export async function POST(request: Request) {
  // 1. Get User Session and Check Permissions
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized: User session not found.' }, { status: 401 });
  }

  // --- Permission Check (Only Staff can confirm checkout) ---
  if (user.role !== UserRole.STAFF) { 
    console.warn(`User ${user.id} with role ${user.role || 'unknown'} attempted bulk checkout confirmation.`);
    return NextResponse.json({ error: 'Forbidden: Only Staff can confirm checkouts.' }, { status: 403 });
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

  const { borrowGroupId } = validatedData;
  const checkoutTime = new Date(); // Checkout happens now

  // 3. Use a transaction for atomicity
  try {
    const updatedBorrows = await prisma.$transaction(async (tx) => {
      // Find the borrow records to be checked out
      const borrowsToConfirm = await tx.borrow.findMany({
        where: {
          borrowGroupId: borrowGroupId,
          borrowStatus: BorrowStatus.APPROVED,
        },
        select: { id: true, equipmentId: true }, // Select IDs needed
      });

      if (borrowsToConfirm.length === 0) {
         const groupExists = await tx.borrow.findFirst({ where: { borrowGroupId } });
         if (!groupExists) {
           throw new Error(`Borrow group with ID ${borrowGroupId} not found.`);
         } else {
           return []; // Indicate nothing was processed (no APPROVED items)
         }
      }

      // --- Optional: Fetch and Log Equipment Statuses (Removed throwing error) ---
      const equipmentIds = borrowsToConfirm.map(b => b.equipmentId).filter(id => id !== null) as string[];
      const equipmentStatuses = await tx.equipment.findMany({
        where: { id: { in: equipmentIds } },
        select: { id: true, status: true, name: true },
      });
      console.log(`[Bulk Checkout TX ${borrowGroupId}] Equipment statuses found:`, equipmentStatuses);
      // Check if any equipment is in an unusable state FOR LOGGING ONLY
      const unusableEquipment = equipmentStatuses.filter(eq => {
          const isUsable = eq.status === EquipmentStatus.AVAILABLE || 
                           eq.status === EquipmentStatus.RESERVED ||
                           eq.status === EquipmentStatus.BORROWED; // Allow BORROWED here temporarily?
          return !isUsable;
      });
      if (unusableEquipment.length > 0) {
         const itemNames = unusableEquipment.map(item => `${item.name}(${item.status})`).join(', ');
         console.warn(`[Bulk Checkout TX ${borrowGroupId}] Warning: Proceeding with checkout despite unusable items: ${itemNames}`);
      }
      // --- End Equipment Status Check Modification ---

      // Update the borrow records (Now runs even if equipment status check had issues)
      const updateResult = await tx.borrow.updateMany({
        where: {
          id: { in: borrowsToConfirm.map(b => b.id) }, // Target specific IDs
        },
        data: {
          borrowStatus: BorrowStatus.ACTIVE,
          checkoutTime: checkoutTime,
        },
      });
      console.log(`[Bulk Checkout TX ${borrowGroupId}] updateMany result:`, updateResult);

      // TODO: Optionally update Equipment status here, after borrow update succeeds
      // (This part is still missing compared to individual checkout)

      return updateResult;

    }); // End Transaction

    // Check transaction result
    // If updatedBorrows is an empty array, it means no APPROVED items were found initially.
    const count = Array.isArray(updatedBorrows) ? 0 : updatedBorrows.count;

    if (count === 0) {
        // This handles the case where the group exists but has no APPROVED items
         return NextResponse.json({ message: `No approved requests found to check out for group ${borrowGroupId}.`, count: 0 }, { status: 200 });
    }

    // 4. Return Success Response
    return NextResponse.json(
      {
        message: `Successfully checked out ${count} approved requests for group ${borrowGroupId}.`,
        count: count,
      },
      { status: 200 }
    );

  } catch (error: unknown) {
    // ... existing error handling ...
    // Add specific check for the new error message
    const errorMessage = error instanceof Error ? error.message : 'Database error occurred during bulk checkout confirmation.';
    if (errorMessage?.includes('not in a usable state')) {
        return NextResponse.json({ error: errorMessage }, { status: 409 }); // 409 Conflict
    }
    console.error(`Failed to bulk confirm checkout for group ${borrowGroupId}:`, error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
} 