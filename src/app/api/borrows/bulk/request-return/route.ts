import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

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

    // Attempt to parse the request body for data request fields
    let parsedBody: unknown = {};
    let requestDataValue = false;
    let dataRequestRemarksValue: string | undefined = undefined;
    let parsedRequestedEquipmentIds: string[] | undefined = undefined; // Store parsed IDs here first

    try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            try {
                parsedBody = await request.json();
                console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) received body:`, JSON.stringify(parsedBody, null, 2));
                if (typeof parsedBody === 'object' && parsedBody !== null) {
                    if ('requestData' in parsedBody && typeof (parsedBody as { requestData: unknown }).requestData === 'boolean') {
                        requestDataValue = (parsedBody as { requestData: boolean }).requestData;
                    }
                    if ('dataRequestRemarks' in parsedBody && typeof (parsedBody as { dataRequestRemarks: unknown }).dataRequestRemarks === 'string') {
                        dataRequestRemarksValue = (parsedBody as { dataRequestRemarks: string }).dataRequestRemarks;
                    }
                    if ('requestedEquipmentIds' in parsedBody && Array.isArray((parsedBody as { requestedEquipmentIds: unknown }).requestedEquipmentIds)) {
                        const ids = (parsedBody as { requestedEquipmentIds: string[] }).requestedEquipmentIds;
                        if (ids.every(id => typeof id === 'string')) {
                            parsedRequestedEquipmentIds = ids; // Store here
                        } else {
                            console.warn(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - requestedEquipmentIds contained non-string elements.`);
                        }
                    }
                }
            } catch (e) {
                console.warn(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - error parsing JSON body:`, e);
            }
        }
    } catch (error) {
        console.error(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - error accessing request body:`, error);
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

        // 4. Prepare data for update
        // Define a type for the update payload
        interface BorrowUpdatePayload {
            borrowStatus: BorrowStatus;
            dataRequested?: boolean;
            dataRequestStatus?: string | null;
            dataRequestRemarks?: string | null;
            requestedEquipmentIds?: string[];
        }

        const updateDataPayload: BorrowUpdatePayload = {
            borrowStatus: BorrowStatus.PENDING_RETURN,
        };

        if (requestDataValue) {
            updateDataPayload.dataRequested = true;
            updateDataPayload.dataRequestStatus = 'Pending';
            if (dataRequestRemarksValue) {
                updateDataPayload.dataRequestRemarks = dataRequestRemarksValue;
            }
            updateDataPayload.requestedEquipmentIds = parsedRequestedEquipmentIds || []; // Use parsed IDs or default to empty array
        } else {
            updateDataPayload.dataRequested = false;
            updateDataPayload.dataRequestRemarks = null;
            updateDataPayload.dataRequestStatus = null;
            updateDataPayload.requestedEquipmentIds = [];
        }
        
        console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Prisma updateMany data:`, JSON.stringify(updateDataPayload, null, 2));

        // Update eligible borrow items in the group
        const updateResult = await prisma.borrow.updateMany({
            where: {
                borrowGroupId: groupId,
                borrowStatus: {
                    in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE]
                }
            },
            data: updateDataPayload,
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