import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; 
import { z } from 'zod';

// Zod schema for validating the incoming request body
const bulkApproveSchema = z.object({
  borrowIds: z.array(z.string().cuid2()).min(1, { message: "At least one Borrow ID must be provided." }),
});

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);

    // 1. Authentication & Authorization
    if (!session?.user?.id) {
        console.error("[Bulk Approve] Unauthorized - No session found.");
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const userRole = session.user.role as UserRole; 
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY]; 

    if (!allowedRoles.includes(userRole)) {
        console.error(`[Bulk Approve] Forbidden - User role ${userRole} not allowed.`);
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    // 2. Parse and Validate Request Body
    let validatedData;
    try {
        const body = await request.json();
        validatedData = bulkApproveSchema.parse(body);
    } catch (error) {
        console.error("[Bulk Approve] Invalid request body:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
    }

    const { borrowIds } = validatedData;

    // 3. Database Transaction
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Find all borrows that are currently PENDING and match the provided IDs
            const borrowsToUpdate = await tx.borrow.findMany({
                where: {
                    id: { in: borrowIds },
                    borrowStatus: BorrowStatus.PENDING,
                },
                select: { id: true } // Select only ID for efficiency
            });

            const foundIds = borrowsToUpdate.map(b => b.id);
            
            // Identify IDs that were requested but not found or not pending
            const notFoundOrNotPendingIds = borrowIds.filter(id => !foundIds.includes(id));
            if (notFoundOrNotPendingIds.length > 0) {
                 console.warn(`[Bulk Approve] The following IDs were not found or not in PENDING state: ${notFoundOrNotPendingIds.join(', ')}`);
                 // Optionally, you could throw an error here to fail the transaction if any ID is invalid
                 // throw new Error(`Some borrow requests are not valid for approval. IDs: ${notFoundOrNotPendingIds.join(', ')}`);
            }

            if (foundIds.length === 0) {
                console.log("[Bulk Approve] No valid PENDING borrows found for the provided IDs.");
                // Depending on desired behavior, you might return success or a specific message
                return { approvedCount: 0 }; 
            }

            // Update the status of the valid PENDING borrows
            const updateResult = await tx.borrow.updateMany({
                where: {
                    id: { in: foundIds }, // Only update the ones we confirmed are PENDING
                    borrowStatus: BorrowStatus.PENDING // Double-check status in where clause
                },
                data: {
                    borrowStatus: BorrowStatus.APPROVED,
                    // Optionally: Add approver details if needed
                    // approvedById: session.user.id,
                    // approvedTime: new Date(),
                },
            });

            console.log(`[Bulk Approve] Successfully updated status for ${updateResult.count} borrows.`);
            return { approvedCount: updateResult.count };
        });

        // Return success response with the count of approved items
        return NextResponse.json({ 
            message: `Successfully approved ${result.approvedCount} reservation(s).`, 
            approvedCount: result.approvedCount 
        });

    } catch (error) {
        console.error("[Bulk Approve] Transaction failed:", error);
        // Handle potential transaction errors (e.g., constraint violations if logic changes)
        return NextResponse.json({ message: 'Internal Server Error during bulk approval' }, { status: 500 });
    }
} 