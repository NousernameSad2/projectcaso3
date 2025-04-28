import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, EquipmentStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Use the correct path
import { z } from 'zod';

interface RouteContext {
  params: {
    borrowId: string; // Borrow ID from the URL
  }
}

// Define a type for the session user
interface SessionUser {
  id: string;
  role: UserRole;
}

// Define expected request body
const confirmReturnSchema = z.object({
  returnCondition: z.string().optional(),
  returnRemarks: z.string().optional(),
  // Optional: Add flag if item is deficient/needs maintenance?
  // markForMaintenance: z.boolean().optional(),
});

// PATCH: Confirm a PENDING_RETURN borrow record (by Staff/Faculty/Admin)
// Correct signature for Next.js 13+ App Router - Modified for potential Promise params
export async function PATCH(request: Request, context: { params: Promise<{ borrowId: string }> | { borrowId: string } }) {
    // --- Await Params Start ---
    // Await the context.params in case it's a Promise (as seen in logs with Next 15 RC)
    const params = await context.params;
    console.log('[Confirm Return] Awaited Params:', params);
    // --- Await Params End ---

    const session = await getServerSession(authOptions);
    // Log entry - Now using the awaited params
    console.log(`[Confirm Return] Received request for borrowId: ${params.borrowId}`);

    // 1. Authentication & Authorization: Ensure user is logged in and has the correct role
    if (!session?.user?.id) {
        console.error("[Confirm Return] Unauthorized - No session found.");
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const userRole = session.user.role as UserRole; 
    
    // Define allowed roles
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY]; 

    if (!userRole || !allowedRoles.includes(userRole)) {
        console.error(`[Confirm Return] Forbidden - User role ${userRole} not allowed.`);
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    // Access borrowId from the *awaited* params
    const borrowId = params.borrowId;
    const userId = session.user.id; // Use userId from session for potential logging

    if (!borrowId) {
        console.error("[Confirm Return] Bad Request - Missing borrowId.");
        // This check might be redundant if the route param is always present
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    // 3. Parse and Validate Request Body
    let validatedData;
    try {
        // --- Added Log Start ---
        console.log('[Confirm Return] Attempting to parse request body...');
        const body = await request.json();
        console.log('[Confirm Return] Raw request body parsed:', body);
        // --- Added Log End ---
        validatedData = confirmReturnSchema.parse(body);
        // --- Added Log Start ---
        console.log('[Confirm Return] Request body validated successfully.');
        // --- Added Log End ---
    } catch (error) {
        // --- Added Log Start ---
        console.error('[Confirm Return] Error parsing or validating request body:', error);
        // --- Added Log End ---
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
    }

    const { returnCondition, returnRemarks } = validatedData;
    const actualReturnTime = new Date();

    try {
        console.log(`[Confirm Return] Starting transaction for borrowId: ${borrowId}`);
        const updatedBorrow = await prisma.$transaction(async (tx) => {
            console.log(`[Confirm Return TX ${borrowId}] Finding borrow record...`);
            const borrowRecord = await tx.borrow.findUnique({
                where: { id: borrowId },
                include: { equipment: true }, // Include equipment to check stock/status
            });
            console.log(`[Confirm Return TX ${borrowId}] Found borrow record:`, !!borrowRecord);

            // 3. Validation: Check if borrow exists
            if (!borrowRecord) {
                throw new Error('Borrow record not found'); // Caught by transaction
            }
            if (!borrowRecord.equipment) {
                // This case should ideally not happen due to schema constraints
                console.error(`[Confirm Return TX ${borrowId}] Critical Error: Borrow record found but associated equipment missing!`);
                throw new Error('Associated equipment not found'); 
            }
            console.log(`[Confirm Return TX ${borrowId}] Equipment details found: ID ${borrowRecord.equipmentId}, Stock ${borrowRecord.equipment.stockCount}`);

            // 4. Status Check: Ensure the borrow is PENDING_RETURN
            if (borrowRecord.borrowStatus !== BorrowStatus.PENDING_RETURN) {
                 console.warn(`[Confirm Return TX ${borrowId}] Status mismatch. Expected PENDING_RETURN, got ${borrowRecord.borrowStatus}.`);
                 throw new Error(`Cannot confirm return for an item not pending return. Status: ${borrowRecord.borrowStatus}`);
            }

            // 5. Update Borrow Record
            console.log(`[Confirm Return TX ${borrowId}] Updating borrow status to RETURNED...`);
            const confirmedBorrow = await tx.borrow.update({
                where: { id: borrowId },
                data: {
                    borrowStatus: BorrowStatus.RETURNED,
                    actualReturnTime: actualReturnTime,
                    returnCondition: returnCondition,
                    returnRemarks: returnRemarks,
                    // Consider adding a field like 'confirmedReturnById: userId'?
                },
            });
            console.log(`[Confirm Return TX ${borrowId}] Borrow status updated.`);

            // 6. Update Equipment Status (if necessary)
            // Check how many items of this type are *still* actively borrowed or reserved
            console.log(`[Confirm Return TX ${borrowId}] Counting active borrows for equipment ${borrowRecord.equipmentId}...`);
            const activeBorrowsCount = await tx.borrow.count({
                where: {
                    equipmentId: borrowRecord.equipmentId,
                    id: { not: borrowId }, 
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.PENDING, BorrowStatus.APPROVED] }, // Removed RESERVED
                },
            });
            console.log(`[Confirm Return TX ${borrowId}] Active borrow count (excluding current): ${activeBorrowsCount}. Stock count: ${borrowRecord.equipment.stockCount}`);

            // If the number of unavailable items is now less than the stock count, mark it as AVAILABLE
            if (activeBorrowsCount < borrowRecord.equipment.stockCount) {
                 console.log(`[Confirm Return TX ${borrowId}] Active count < stock count. Checking equipment status...`);
                 const currentEquipmentStatus = borrowRecord.equipment.status;
                 if (currentEquipmentStatus === EquipmentStatus.BORROWED) {
                    console.log(`[Confirm Return TX ${borrowId}] Equipment status is BORROWED. Updating to AVAILABLE...`);
                    await tx.equipment.update({
                        where: { id: borrowRecord.equipmentId },
                        data: { status: EquipmentStatus.AVAILABLE },
                    });
                     console.log(`[Confirm Return TX ${borrowId}] Equipment status updated to AVAILABLE.`);
                 } else {
                     console.log(`[Confirm Return TX ${borrowId}] Equipment status is ${currentEquipmentStatus}, not updating.`);
                 }
            } else {
                 console.log(`[Confirm Return TX ${borrowId}] Active count (${activeBorrowsCount}) >= stock count (${borrowRecord.equipment.stockCount}). Not updating equipment status.`);
            }

            console.log(`[Confirm Return TX ${borrowId}] Transaction complete.`);
            return confirmedBorrow; // Return the updated borrow record from transaction
        });

        console.log(`[Confirm Return] Successfully confirmed return for borrowId: ${borrowId}`);
        return NextResponse.json(updatedBorrow);

    } catch (error) {
        // Log the specific error that occurred
        console.error(`[Confirm Return] FAILED for borrowId: ${borrowId}. Error:`, error);
        
        // Return specific error messages based on known errors
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                return NextResponse.json({ message: error.message }, { status: 404 });
            }
             if (error.message.includes('Cannot confirm return')) {
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }
        // Generic fallback for other errors
        return NextResponse.json({ message: 'Internal Server Error during return confirmation' }, { status: 500 });
    }
} 