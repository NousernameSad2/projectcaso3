import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole, EquipmentStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import
import { z } from 'zod';

const prisma = new PrismaClient();

// Define the expected shape of the request body
const bulkActionSchema = z.object({
  borrowGroupId: z.string().min(1).optional(),
  borrowId: z.string().min(1).optional(),
  // Optional: Add returnCondition, returnRemarks later if needed for bulk
}).refine(data => !!data.borrowGroupId !== !!data.borrowId, {
  message: "Either borrowGroupId OR borrowId must be provided, but not both.",
});

export async function POST(request: Request) {
  // --- START: Route Entry Log ---
  console.log('[API /borrows/bulk/return] Received POST request.');
  // --- END: Route Entry Log ---

  // 1. Get User Session and Check Permissions
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized: User session not found.' }, { status: 401 });
  }
  const { user } = session;

  console.log(`[API /borrows/bulk/return] User ID: ${user.id}, Role: ${user.role}`);

  // Permission Check: Only Staff and Faculty can confirm bulk returns
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY]; // Assuming only STAFF can confirm return
  if (!user.role || !allowedRoles.includes(user.role as UserRole)) {
    console.warn(`[API /borrows/bulk/return] Forbidden: User ${user.id} with role ${user.role || 'unknown'} attempted action.`);
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions.' }, { status: 403 });
  }
  console.log(`[API /borrows/bulk/return] Permission check passed for user ${user.id}.`);
  // --- End Permission Check ---

  // 2. Parse and Validate Request Body
  let validatedData;
  try {
    const body = await request.json();
    console.log('[API /borrows/bulk/return] Raw request body:', body);
    validatedData = bulkActionSchema.parse(body);
    console.log('[API /borrows/bulk/return] Validated request data:', validatedData);
  } catch (error) {
    console.error('[API /borrows/bulk/return] Error parsing/validating request body:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  const { borrowGroupId, borrowId } = validatedData;
  const returnTimestamp = new Date(); // Record the return time
  console.log(`[API /borrows/bulk/return] Target: ${borrowGroupId ? 'Group ' + borrowGroupId : 'Single ' + borrowId}, Timestamp: ${returnTimestamp.toISOString()}`);

  // 3. Perform the update (single or bulk)
  try {
    // --- Define update data outside transaction --- 
    const updateData = {
        borrowStatus: BorrowStatus.RETURNED, 
        actualReturnTime: returnTimestamp,
        approvedByStaffId: user.id, // Record who confirmed the return (moved here)
    };

    let result;

    if (borrowId) {
       // --- Single Item Return (Now uses transaction for consistency) ---
       console.log(`[API /borrows/bulk/return - Single ${borrowId}] Starting transaction...`);
       result = await prisma.$transaction(async (tx) => {
           const borrowToReturn = await tx.borrow.findUnique({
               where: { id: borrowId, borrowStatus: BorrowStatus.PENDING_RETURN },
               select: { id: true, equipmentId: true }
           });

           if (!borrowToReturn) {
               const exists = await tx.borrow.findUnique({ where: { id: borrowId }, select: { borrowStatus: true } });
               if (!exists) throw new Error(`Borrow record ${borrowId} not found.`);
               throw new Error(`Borrow record ${borrowId} is not pending return (Status: ${exists.borrowStatus}).`);
           }
           const equipmentId = borrowToReturn.equipmentId as string; // Assert as string

           await tx.borrow.update({
              where: { id: borrowId },
              data: updateData, // Use pre-defined updateData
           });
           console.log(`[API /borrows/bulk/return - Single ${borrowId}] Borrow status updated.`);

           // *** NEW: Update Equipment Status (Single Item) ***
           const equipment = await tx.equipment.findUnique({ where: { id: equipmentId }, select: { stockCount: true, status: true }});
           if (!equipment) throw new Error(`Equipment ${equipmentId} not found during return confirmation.`);

           const activeBorrowsCount = await tx.borrow.count({
               where: {
                   equipmentId: equipmentId,
                   id: { not: borrowId }, // Exclude the one just returned
                   borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.PENDING, BorrowStatus.APPROVED] },
               },
           });
           console.log(`[API /borrows/bulk/return TX - Single ${borrowId}] Active count: ${activeBorrowsCount}, Stock: ${equipment.stockCount}`);

           if (activeBorrowsCount < equipment.stockCount && equipment.status === EquipmentStatus.BORROWED) {
                console.log(`[API /borrows/bulk/return TX - Single ${borrowId}] Updating Equipment ${equipmentId} to AVAILABLE.`);
                await tx.equipment.update({
                    where: { id: equipmentId },
                    data: { status: EquipmentStatus.AVAILABLE },
                });
           }
           // *** END NEW ***

           console.log(`[API /borrows/bulk/return - Single ${borrowId}] Transaction complete.`);
           return { count: 1 }; // Return count consistent with bulk
       });

    } else if (borrowGroupId) {
       // --- Bulk Item Return (Revised Logic + Transaction) ---
       // --- START: Before Bulk Transaction Log ---
       console.log(`[API /borrows/bulk/return - Group ${borrowGroupId}] Preparing to start transaction...`);
       // --- END: Before Bulk Transaction Log ---
       result = await prisma.$transaction(async (tx) => {
           // --- START: Inside Bulk Transaction Log ---
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Transaction started.`);
           // --- END: Inside Bulk Transaction Log ---
           
           // 1. Find all items in the group that are PENDING_RETURN
           // --- START: Before findMany Log ---
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Finding items with borrowGroupId: ${borrowGroupId} and status: PENDING_RETURN...`);
           // --- END: Before findMany Log ---
           const itemsToReturn = await tx.borrow.findMany({
             where: {
               borrowGroupId: borrowGroupId,
               borrowStatus: BorrowStatus.PENDING_RETURN,
             },
             select: { id: true, equipmentId: true },
           });
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Found ${itemsToReturn.length} items pending return:`, itemsToReturn.map(i => i.id));

           // 2. Check if any items were found
           if (itemsToReturn.length === 0) {
              console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] No items pending return found. Checking if group exists...`);
             const groupExists = await tx.borrow.findFirst({ where: { borrowGroupId } });
             if (!groupExists) {
                console.error(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Error: Borrow group not found.`);
                throw new Error(`Borrow group ${borrowGroupId} not found.`);
             } else {
                console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Group exists, but no items pending return. Completing transaction.`);
                // Return count 0 from transaction to indicate nothing was updated
                return { count: 0 }; 
             }
           }

           // 3. Get the IDs of the items and unique equipment IDs
           const itemIdsToUpdate = itemsToReturn.map(item => item.id);
           const uniqueEquipmentIds = Array.from(new Set(itemsToReturn.map(item => item.equipmentId).filter((id): id is string => id !== null)));
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] IDs to update:`, itemIdsToUpdate);
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Unique Equipment IDs:`, uniqueEquipmentIds);

           // 4. Perform the borrow status update 
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Attempting borrow updateMany for IDs: ${itemIdsToUpdate.join(', ')}...`);
           const updateResult = await tx.borrow.updateMany({
             where: {
               id: { in: itemIdsToUpdate }, 
             },
             data: updateData, // Use pre-defined updateData
           });
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] updateMany result:`, updateResult);
           
           // 5. *** NEW: Update Equipment Statuses (Bulk) ***
           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Updating equipment statuses...`);
           for (const equipmentId of uniqueEquipmentIds) { // equipmentId is now string
               const equipment = await tx.equipment.findUnique({ where: { id: equipmentId }, select: { stockCount: true, status: true }});
               if (!equipment) {
                   console.warn(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Equipment ${equipmentId} not found during status update. Skipping.`);
                   continue; 
               }

               // Count remaining commitments: ACTIVE, OVERDUE, or APPROVED borrows for this equipment,
               // EXCLUDING the items being returned in this specific transaction.
               const outstandingCommitmentsCount = await tx.borrow.count({
                   where: {
                       equipmentId: equipmentId,
                       id: { notIn: itemIdsToUpdate }, // Exclude items just processed in this return operation
                       borrowStatus: { in: [
                           BorrowStatus.ACTIVE, 
                           BorrowStatus.OVERDUE, 
                           BorrowStatus.APPROVED 
                       ] },
                   },
               });
               console.log(`[API /borrows/bulk/return TX - Equip ${equipmentId}] Outstanding commitments (Active, Overdue, Approved): ${outstandingCommitmentsCount}, Stock: ${equipment.stockCount}`);

               // If there are no outstanding commitments, the equipment can become AVAILABLE
               // unless it's in a terminal state (e.g., maintenance, defective).
               if (outstandingCommitmentsCount === 0) {
                   if (
                       equipment.status !== EquipmentStatus.AVAILABLE &&
                       equipment.status !== EquipmentStatus.UNDER_MAINTENANCE &&
                       equipment.status !== EquipmentStatus.DEFECTIVE &&
                       equipment.status !== EquipmentStatus.OUT_OF_COMMISSION &&
                       equipment.status !== EquipmentStatus.ARCHIVED
                   ) {
                       console.log(`[API /borrows/bulk/return TX - Equip ${equipmentId}] No outstanding commitments. Updating Equipment to AVAILABLE from ${equipment.status}.`);
                       await tx.equipment.update({
                           where: { id: equipmentId },
                           data: { status: EquipmentStatus.AVAILABLE },
                       });
                   }
               } else {
                   // Optional: If there are still commitments, but fewer than stockCount, 
                   // and current status is BORROWED (implying all were out), 
                   // it might revert to RESERVED if all remaining commitments are APPROVED, or stay AVAILABLE if some are active borrows.
                   // For now, we primarily focus on making it AVAILABLE when fully free.
                   // The EquipmentCard will handle the display nuance.
                   console.log(`[API /borrows/bulk/return TX - Equip ${equipmentId}] Still ${outstandingCommitmentsCount} outstanding commitments. Equipment status ${equipment.status} unchanged by this logic block.`);
               }
           }
           // *** END NEW ***

           console.log(`[API /borrows/bulk/return TX - Group ${borrowGroupId}] Transaction complete.`);
           return updateResult; // Return the result of borrow updateMany
        }); // End Transaction
        console.log(`[API /borrows/bulk/return - Group ${borrowGroupId}] Transaction block finished.`);

    } else {
       // Should be caught by refine
       console.error('[API /borrows/bulk/return] Error: Invalid request state (no borrowId or borrowGroupId).');
       return NextResponse.json({ error: 'Invalid request: Missing borrowId or borrowGroupId.' }, { status: 400 });
    }

    // Handle count 0 result from transaction (means no PENDING_RETURN items were found)
    if (result.count === 0 && borrowGroupId) {
        console.log(`[API /borrows/bulk/return - Group ${borrowGroupId}] Handling result: No items were pending return.`);
       return NextResponse.json({ message: `No requests pending return found in group ${borrowGroupId}.`, count: 0 }, { status: 200 });
    }

    // 4. Return Success Response
    const target = borrowId ? `request ${borrowId}` : `group ${borrowGroupId}`;
    const count = result?.count ?? 0; 
    console.log(`[API /borrows/bulk/return] Success response: ${count} items updated for ${target}.`);
    return NextResponse.json(
      {
        message: `Successfully confirmed return for ${count} ${borrowId ? 'item' : 'items pending return'} for ${target}.`,
        count: count,
      },
      { status: 200 }
    );

  } catch (error) {
    const target = borrowGroupId || borrowId || 'unknown';
    // --- START: Catch Block Log ---
    console.error(`[API /borrows/bulk/return] CATCH BLOCK: Error during processing for ${target}. Error:`, error);
    // --- END: Catch Block Log ---
    // Handle specific errors thrown from transaction
    if (error instanceof Error) {
         if (error.message.includes('not found')) {
             return NextResponse.json({ error: error.message }, { status: 404 });
         }
          if (error.message.includes('not pending return')) {
             return NextResponse.json({ error: error.message }, { status: 400 });
         }
     }
    return NextResponse.json({ error: 'Database error occurred during return confirmation.' }, { status: 500 });
  }
} 