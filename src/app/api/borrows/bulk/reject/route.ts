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

  // 4. Perform the update using a transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      let updatedCount = 0;
      let equipmentToCheck: { id: string }[] = [];

      if (borrowId) {
        // --- Single Item Rejection --- 
        const borrowToReject = await tx.borrow.findUnique({
          where: { id: borrowId, borrowStatus: BorrowStatus.PENDING },
          select: { id: true, equipmentId: true } // Select equipmentId
        });

        if (!borrowToReject) {
          const exists = await tx.borrow.findUnique({ where: { id: borrowId } });
          if (!exists) throw new Error(`Borrow record ${borrowId} not found.`);
          throw new Error(`Borrow record ${borrowId} is not pending rejection.`);
        }

        await tx.borrow.update({
          where: { id: borrowId },
          data: { borrowStatus: rejectionStatus },
        });
        updatedCount = 1;
        if (borrowToReject.equipmentId) {
            equipmentToCheck.push({ id: borrowToReject.equipmentId });
        }

      } else if (borrowGroupId) {
        // --- Bulk Item Rejection --- 
        // Find items to reject first to get their equipment IDs
        const borrowsToReject = await tx.borrow.findMany({
          where: {
            borrowGroupId: borrowGroupId,
            borrowStatus: BorrowStatus.PENDING,
          },
          select: { id: true, equipmentId: true },
        });

        if (borrowsToReject.length === 0) {
            const groupExists = await tx.borrow.findFirst({ where: { borrowGroupId } });
            if (!groupExists) throw new Error(`Borrow group ${borrowGroupId} not found.`);
            // If group exists but no PENDING, return 0 count successfully
            return { count: 0 }; 
        }

        const borrowIdsToUpdate = borrowsToReject.map(b => b.id);
        equipmentToCheck = borrowsToReject
            .map(b => b.equipmentId)
            .filter((id): id is string => id !== null)
            .map(id => ({ id }));

        const updateResult = await tx.borrow.updateMany({
          where: { id: { in: borrowIdsToUpdate } },
          data: { borrowStatus: rejectionStatus },
        });
        updatedCount = updateResult.count;

      } else {
        throw new Error('Invalid request: Missing borrowId or borrowGroupId.');
      }
      
      // --- Update Equipment Status --- 
      if (updatedCount > 0 && equipmentToCheck.length > 0) {
          const uniqueEquipmentIds = Array.from(new Set(equipmentToCheck.map(eq => eq.id)));
          console.log(`[Reject TX] Checking equipment status for IDs: ${uniqueEquipmentIds.join(', ')}`);

          for (const eqId of uniqueEquipmentIds) {
              if (!eqId) continue;
              // Check if ANY other borrows for this equipment are active/approved/reserved
              const otherActiveBorrowsCount = await tx.borrow.count({
                  where: {
                      equipmentId: eqId,
                      borrowStatus: { 
                          in: [BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.PENDING] 
                          // Exclude PENDING? If rejecting one pending shouldn't prevent others?
                          // Let's keep PENDING for now to be safe - if one PENDING is rejected,
                          // but another is still PENDING, item should likely stay RESERVED.
                      },
                      // Exclude the borrows we just rejected (though their status is updated already)
                      // id: { notIn: borrowIdsToUpdate } // Not needed if checking status
                  }
              });

              console.log(`[Reject TX - Equip ${eqId}] Other active/pending/approved borrows: ${otherActiveBorrowsCount}`);

              if (otherActiveBorrowsCount === 0) {
                  // Only set to AVAILABLE if no other active borrows exist
                  // Also check current status? Only update if RESERVED?
                  await tx.equipment.updateMany({
                      where: { 
                          id: eqId, 
                          // Optionally check if current status is RESERVED
                          status: EquipmentStatus.RESERVED 
                      },
                      data: { status: EquipmentStatus.AVAILABLE },
                  });
                   console.log(`[Reject TX - Equip ${eqId}] Status updated to AVAILABLE.`);
              } else {
                   console.log(`[Reject TX - Equip ${eqId}] Status not changed (other active borrows exist).`);
              }
          }
      }
      
      return { count: updatedCount };

    }); // End Transaction

    // Handle count 0 result from transaction
    if (result.count === 0 && borrowGroupId) {
        return NextResponse.json({ message: `No pending requests found in group ${borrowGroupId}.`, count: 0 }, { status: 200 });
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
    const target = borrowGroupId || borrowId || 'unknown';
    console.error(`Failed to bulk reject requests for ${target}:`, error);
    // Handle specific errors thrown from transaction
    if (error instanceof Error) {
        if (error.message.includes('not found')) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
         if (error.message.includes('not pending rejection')) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
    }
    return NextResponse.json({ error: 'Database error occurred during bulk rejection.' }, { status: 500 });
  }
} 