import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

const prisma = new PrismaClient();

interface RequestBody {
    requestData?: boolean;
    dataRequestRemarks?: string;
    requestedEquipmentIds?: string[];
}

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

    let body: RequestBody = {};
    try {
        if (request.body) {
            body = await request.json();
        }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
        // console.warn(`Could not parse request body: ${_e}`);
        // Proceed with empty body, defaults will apply
    }

    const { requestData = false, dataRequestRemarks, requestedEquipmentIds } = body;

    try {
        // 3. Authorization Check: Verify user is part of the group or the original borrower
        const representativeBorrow = await prisma.borrow.findFirst({
            where: { borrowGroupId: groupId },
            select: { borrowerId: true }
        });

        if (!representativeBorrow) {
             return NextResponse.json({ error: `Borrow group not found: ${groupId}` }, { status: 404 });
        }

        const isBorrower = representativeBorrow.borrowerId === userId;
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

        if (!isBorrower && !isGroupMate) {
             return NextResponse.json({ error: 'Forbidden: You are not authorized to request return for this group.' }, { status: 403 });
        }

        let totalUpdatedCount = 0;

        if (requestData && requestedEquipmentIds && requestedEquipmentIds.length > 0) {
            // Scenario 1: Data is requested for specific items
            const itemsWithDataRequestUpdate = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    equipmentId: { in: requestedEquipmentIds },
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] },
                },
                data: {
                    borrowStatus: BorrowStatus.PENDING_RETURN,
                    dataRequested: true,
                    dataRequestStatus: 'Pending',
                    dataRequestRemarks: dataRequestRemarks,
                },
            });
            totalUpdatedCount += itemsWithDataRequestUpdate.count;

            const itemsWithoutDataRequestUpdate = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    equipmentId: { notIn: requestedEquipmentIds },
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] },
                },
                data: {
                    borrowStatus: BorrowStatus.PENDING_RETURN,
                    dataRequested: false,
                    dataRequestStatus: null,
                    dataRequestRemarks: null,
                },
            });
            totalUpdatedCount += itemsWithoutDataRequestUpdate.count;
        } else {
            // Scenario 2: No specific equipment IDs for data request OR data is not requested at all
            const updateResult = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] },
                },
                data: {
                    borrowStatus: BorrowStatus.PENDING_RETURN,
                    dataRequested: requestData, // Will be true if data is generally requested, false otherwise
                    dataRequestStatus: requestData ? 'Pending' : null,
                    dataRequestRemarks: requestData ? dataRequestRemarks : null,
                },
            });
            totalUpdatedCount = updateResult.count;
        }
        
        // 5. Handle Response
        if (totalUpdatedCount === 0) {
            return NextResponse.json({ message: 'No active or overdue items found in the group to request return for.', count: 0 });
        }

        return NextResponse.json({ message: `Successfully requested return for ${totalUpdatedCount} items in group ${groupId}.`, count: totalUpdatedCount });

    } catch (error) {
        console.error(`Failed to request return for group ${groupId}:`, error);
        return NextResponse.json({ error: 'An error occurred while processing the group return request.' }, { status: 500 });
    }
} 