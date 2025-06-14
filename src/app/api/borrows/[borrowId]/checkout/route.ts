import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, EquipmentStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

// PATCH: Mark an APPROVED borrow record as ACTIVE (Checked Out by Staff/Faculty)
// Correct signature for Next.js 13+ App Router
export async function PATCH(request: Request, context: { params: Promise<{ borrowId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params; // Await the params

    // 1. Authentication & Authorization: Ensure user is Staff/Faculty/Admin
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];

    if (!allowedRoles.includes(user.role as UserRole)) {
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    const borrowId = params.borrowId;

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    try {
        // Use a transaction to ensure atomicity
        const updatedBorrow = await prisma.$transaction(async (tx) => {
            // 2. Find the borrow record and related equipment
            const borrowRecord = await tx.borrow.findUnique({
                where: { id: borrowId },
                include: { equipment: true },
            });

            // 3. Validation: Check if borrow exists
            if (!borrowRecord) {
                throw new Error('Borrow record not found');
            }
            if (!borrowRecord.equipment) {
                throw new Error('Associated equipment not found');
            }

            // 4. Status Check: Ensure the borrow is APPROVED
            if (borrowRecord.borrowStatus !== BorrowStatus.APPROVED) {
                 throw new Error(`Cannot checkout item. Status is not APPROVED: ${borrowRecord.borrowStatus}`);
            }

            // 5. Determine new status (ACTIVE or OVERDUE) and update Borrow Record
            const now = new Date();
            let newStatus: BorrowStatus = BorrowStatus.ACTIVE;
            // Ensure approvedEndTime is not null before comparing
            if (borrowRecord.approvedEndTime && new Date(borrowRecord.approvedEndTime) < now) {
                newStatus = BorrowStatus.OVERDUE;
            }

            const checkedOutBorrow = await tx.borrow.update({
                where: { id: borrowId },
                data: {
                    borrowStatus: newStatus, // Use the determined status
                    checkoutTime: now,       // Record the actual checkout time
                    // confirmedCheckoutById: session.user.id // Optional: track who confirmed checkout
                },
            });

            // 6. Update Equipment Status to BORROWED
            // Only update if the equipment is currently AVAILABLE or RESERVED
            // Avoid overriding statuses like UNDER_MAINTENANCE
            const currentEquipmentStatus = borrowRecord.equipment.status;
            if (currentEquipmentStatus === EquipmentStatus.AVAILABLE || currentEquipmentStatus === EquipmentStatus.RESERVED) {
                await tx.equipment.update({
                    where: { id: borrowRecord.equipmentId ?? undefined },
                    data: { status: EquipmentStatus.BORROWED },
                });
            } else {
                // Log a warning if the equipment status is unexpected but proceed with borrow update
                console.warn(`Equipment ${borrowRecord.equipment.name} (${borrowRecord.equipmentId}) status was ${currentEquipmentStatus}, expected AVAILABLE or RESERVED during checkout.`);
            }

            return checkedOutBorrow; 
        });

        return NextResponse.json(updatedBorrow);

    } catch (error) {
        console.error(`API Error - PATCH /api/borrows/${borrowId}/checkout:`, error);
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                return NextResponse.json({ message: error.message }, { status: 404 });
            }
            if (error.message.includes('Cannot checkout item')) {
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }
        return NextResponse.json({ message: 'Internal Server Error during checkout process' }, { status: 500 });
    }
} 