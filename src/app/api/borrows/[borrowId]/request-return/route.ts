import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole, Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

interface SessionUser {
  id: string;
  role: UserRole;
}

interface RequestBody {
    requestData?: boolean;
    dataRequestRemarks?: string;
    // requestedEquipmentIds might be sent by modal but less relevant for single item return context
    // It won't directly filter here, but we acknowledge it might be in payload.
    requestedEquipmentIds?: string[]; 
}

// PATCH: Mark an active borrow as PENDING_RETURN by the borrower
export async function PATCH(req: NextRequest, context: { params: Promise<{ borrowId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    const user = session?.user as SessionUser | undefined;

    if (!user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;
    const borrowId = params.borrowId;

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    let body: RequestBody = {};
    try {
        if (req.body) {
            body = await req.json();
        }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
        // console.warn(`Could not parse request body for borrow ${borrowId}: ${_error}`);
    }

    const { requestData = false, dataRequestRemarks } = body;

    try {
        // Request body parsing for data request fields is removed.
        // console.log(`API /borrows/${borrowId}/request-return PATCH received request.`);

        const borrowRecord = await prisma.borrow.findUnique({
            where: { id: borrowId },
        });

        if (!borrowRecord) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        if (borrowRecord.borrowerId !== userId) {
            // console.warn(`User ${userId} attempted to request return for borrow ${borrowId} owned by ${borrowRecord.borrowerId}`);
            return NextResponse.json({ message: 'Forbidden: You did not borrow this item' }, { status: 403 });
        }

        if (!(borrowRecord.borrowStatus === BorrowStatus.ACTIVE || borrowRecord.borrowStatus === BorrowStatus.OVERDUE)) {
            return NextResponse.json(
                { error: `Cannot request return for item with status: ${borrowRecord.borrowStatus}` },
                { status: 400 }
            );
        }

        const updateData: Prisma.BorrowUpdateInput = {
            borrowStatus: BorrowStatus.PENDING_RETURN,
            dataRequested: requestData,
            dataRequestStatus: requestData ? 'Pending' : null,
            dataRequestRemarks: requestData ? dataRequestRemarks : null,
        };

        // console.log(`API /request-return PATCH (borrowId: ${borrowId}) - Prisma update data:`, JSON.stringify(updateData, null, 2));

        const updatedBorrow = await prisma.borrow.update({
            where: { id: borrowId },
            data: updateData,
        });

        // TODO: Consider creating a notification for admin/staff

        return NextResponse.json(updatedBorrow);

    } catch (error) {
        console.error("Error processing data request return:", error);
        // const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        return NextResponse.json({ message: "Error processing your request." }, { status: 500 });
    }
}