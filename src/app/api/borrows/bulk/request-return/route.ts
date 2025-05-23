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

        let totalUpdatedCount = 0;

        if (requestDataValue && parsedRequestedEquipmentIds && parsedRequestedEquipmentIds.length > 0) {
            // Scenario 1: Data is requested for specific items
            console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Processing with data request for specific equipment IDs:`, parsedRequestedEquipmentIds);

            // Update items for which data IS requested
            const itemsWithDataRequestUpdate = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    equipmentId: { in: parsedRequestedEquipmentIds }, // Target specific equipment
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] },
                },
                data: {
                    borrowStatus: BorrowStatus.PENDING_RETURN,
                    dataRequested: true,
                    dataRequestStatus: 'Pending',
                    dataRequestRemarks: dataRequestRemarksValue, // Apply remarks to these items
                },
            });
            totalUpdatedCount += itemsWithDataRequestUpdate.count;
            console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Updated ${itemsWithDataRequestUpdate.count} items WITH data request.`);

            // Update items for which data IS NOT requested (but part of the same group and return operation)
            const itemsWithoutDataRequestUpdate = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    equipmentId: { notIn: parsedRequestedEquipmentIds }, // Target other equipment in the group
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
            console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Updated ${itemsWithoutDataRequestUpdate.count} items WITHOUT data request.`);

        } else {
            // Scenario 2: No data is requested, or no specific equipment IDs provided for data request
            // Update all eligible items in the group to PENDING_RETURN and ensure data request fields are cleared/false
            console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Processing WITHOUT specific data requests for items, or requestData was false.`);
            const updateAllEligibleResult = await prisma.borrow.updateMany({
                where: {
                    borrowGroupId: groupId,
                    borrowStatus: { in: [BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] },
                },
                data: {
                    borrowStatus: BorrowStatus.PENDING_RETURN,
                    dataRequested: false, // Explicitly set to false if no data requested for any
                    dataRequestStatus: null,
                    dataRequestRemarks: null,
                },
            });
            totalUpdatedCount = updateAllEligibleResult.count;
            console.log(`API /borrows/bulk/request-return PATCH (groupId: ${groupId}) - Updated ${totalUpdatedCount} items (no specific data requests).`);
        }
        
        // 5. Handle Response
        if (totalUpdatedCount === 0) {
            // This could happen if all items were already returned or pending return
            return NextResponse.json({ message: 'No active or overdue items found in the group to request return for.', count: 0 });
        }

        return NextResponse.json({ message: `Successfully requested return for ${totalUpdatedCount} items in group ${groupId}.`, count: totalUpdatedCount });

    } catch (error) {
        console.error(`Failed to request return for group ${groupId}:`, error);
        // Consider more specific error checking (e.g., Prisma errors) if needed
        return NextResponse.json({ error: 'An error occurred while processing the group return request.' }, { status: 500 });
    }
} 