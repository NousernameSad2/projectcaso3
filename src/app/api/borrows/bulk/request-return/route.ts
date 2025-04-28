import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function PATCH(request: Request) {
    // 1. Get User Session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // 2. Get groupId from URL
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    if (!groupId) {
        return NextResponse.json({ error: 'Missing groupId parameter' }, { status: 400 });
    }

    try {
        // 3. Authorization Check: Verify user is part of the group or the original borrower
        // Find one borrow record associated with the group to get the borrowerId
        const representativeBorrow = await prisma.borrow.findFirst({
            where: { borrowGroupId: groupId },
            select: { borrowerId: true }
        });

        // If no borrow records found for the group, it's an issue
        if (!representativeBorrow) {
             return NextResponse.json({ error: `Borrow group not found: ${groupId}` }, { status: 404 });
        }

        // Check if the user is the original borrower
        const isBorrower = representativeBorrow.borrowerId === userId;

        // Check if the user is a group mate (if not the borrower)
        let isGroupMate = false;
        if (!isBorrower) {
            const groupMateRecord = await prisma.borrowGroupMate.findFirst({
                where: {
                    borrowGroupId: groupId,
                    userId: userId,
                }
            });
            isGroupMate = !!groupMateRecord;
        }

        // If user is neither the borrower nor a group mate, deny access
        if (!isBorrower && !isGroupMate) {
             return NextResponse.json({ error: 'Forbidden: You are not authorized to request return for this group.' }, { status: 403 });
        }

        // 4. Update eligible borrow items in the group to PENDING_RETURN
        const updateResult = await prisma.borrow.updateMany({
            where: {
                borrowGroupId: groupId,
                // Only update items that are currently checked out
                borrowStatus: {
                    in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE]
                }
            },
            data: {
                borrowStatus: BorrowStatus.PENDING_RETURN,
                // Optionally, could add a field like `returnRequestedById: userId`
                // Optionally, could add a field like `returnRequestedAt: new Date()`
            },
        });

        // 5. Handle Response
        if (updateResult.count === 0) {
            // This could happen if all items were already returned or pending return
            return NextResponse.json({ message: 'No active or overdue items found in the group to request return for.', count: 0 });
        }

        return NextResponse.json({ message: `Successfully requested return for ${updateResult.count} items in group ${groupId}.`, count: updateResult.count });

    } catch (error) {
        console.error(`Failed to request return for group ${groupId}:`, error);
        // Consider more specific error checking (e.g., Prisma errors) if needed
        return NextResponse.json({ error: 'An error occurred while processing the group return request.' }, { status: 500 });
    }
} 