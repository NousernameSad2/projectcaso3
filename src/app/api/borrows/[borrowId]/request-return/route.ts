import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

interface SessionUser {
  id: string;
  role: UserRole;
}

// PATCH: Mark an active borrow as PENDING_RETURN by the borrower
export async function PATCH(req: NextRequest, context: { params: Promise<{ borrowId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    const user = session?.user as SessionUser | undefined;

    // 1. Authentication: Ensure user is logged in
    if (!user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    
    // Access params.borrowId *after* await
    const borrowId = params.borrowId;

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    try {
        // 2. Find the borrow record
        const borrowRecord = await prisma.borrow.findUnique({
            where: { id: borrowId },
        });

        // 3. Validation: Check if borrow exists
        if (!borrowRecord) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        // 4. Authorization: Check if the logged-in user is the borrower
        if (borrowRecord.borrowerId !== userId) {
            console.warn(`User ${userId} attempted to request return for borrow ${borrowId} owned by ${borrowRecord.borrowerId}`);
            return NextResponse.json({ message: 'Forbidden: You did not borrow this item' }, { status: 403 });
        }

        // 5. Status Check: Ensure the borrow is currently ACTIVE or OVERDUE
        if (!(borrowRecord.borrowStatus === BorrowStatus.ACTIVE || borrowRecord.borrowStatus === BorrowStatus.OVERDUE)) {
            return NextResponse.json(
                { error: `Cannot request return for item with status: ${borrowRecord.borrowStatus}` },
                { status: 400 } // Bad Request
            );
        }

        // --- Removed Deficiency Log Block --- 

        // 6. Update the status
        const updatedBorrow = await prisma.borrow.update({
            where: { id: borrowId },
            data: {
                borrowStatus: BorrowStatus.PENDING_RETURN,
                // Optionally clear other fields if needed upon return request
            },
        });

        // Return the updated borrow record directly
        return NextResponse.json(updatedBorrow); 

    } catch (error) {
        console.error(`API Error - PATCH /api/borrows/${borrowId}/request-return:`, error);
        // Consider more specific error checking if needed
        if (error instanceof Error && error.message.includes('findUnique')) {
             return NextResponse.json({ message: 'Borrow record not found or invalid ID format' }, { status: 404 });
        }
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}