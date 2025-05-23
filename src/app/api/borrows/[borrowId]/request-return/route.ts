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
        // Parse request body for data request fields
        let requestDataValue = false; // Renamed to avoid conflict with Prisma field
        let dataRequestRemarksValue: string | undefined = undefined; // Renamed
        let parsedBody: unknown = {}; // Changed from any to unknown
        
        // Define a type for the update payload for single item return
        interface SingleBorrowUpdatePayload {
            borrowStatus?: BorrowStatus; // Made optional as it might be set later or already correct
            dataRequested?: boolean;
            dataRequestStatus?: string | null;
            dataRequestRemarks?: string | null;
            requestedEquipmentIds?: string[];
        }
        const updateData: SingleBorrowUpdatePayload = {}; // Initialize as const with the defined type

        try {
            const body = await req.json();
            parsedBody = body;
            // Log the received body - ensure it's an object for stringify
            if (typeof parsedBody === 'object' && parsedBody !== null) {
                console.log("API /request-return PATCH received body:", JSON.stringify(parsedBody, null, 2)); 
            } else {
                console.log("API /request-return PATCH received non-object body:", parsedBody);
            }
            
            // Type guard for accessing properties
            if (typeof body === 'object' && body !== null) {
                if ('requestData' in body && typeof (body as { requestData: unknown }).requestData === 'boolean') {
                    requestDataValue = (body as { requestData: boolean }).requestData;
                }
                if ('dataRequestRemarks' in body && typeof (body as { dataRequestRemarks: unknown }).dataRequestRemarks === 'string') {
                    dataRequestRemarksValue = (body as { dataRequestRemarks: string }).dataRequestRemarks;
                }
                // New: Parse requestedEquipmentIds
                if ('requestedEquipmentIds' in body && Array.isArray((body as { requestedEquipmentIds: unknown }).requestedEquipmentIds)) {
                    // Basic validation: ensure all elements are strings (ObjectIds)
                    const ids = (body as { requestedEquipmentIds: string[] }).requestedEquipmentIds;
                    if (ids.every(id => typeof id === 'string')) {
                        updateData.requestedEquipmentIds = ids;
                    } else {
                        console.warn("API /request-return PATCH: requestedEquipmentIds contained non-string elements.");
                        updateData.requestedEquipmentIds = []; // Default to empty if validation fails
                    }
                } else if (requestDataValue) { // If data is requested but no IDs are provided
                    updateData.requestedEquipmentIds = [];
                }
            }
        } catch {
            // Ignore error if body is not present or not JSON, defaults will be used
        }

        if (requestDataValue) {
            updateData.dataRequested = true;
            updateData.dataRequestStatus = 'Pending';
            if (dataRequestRemarksValue) {
                updateData.dataRequestRemarks = dataRequestRemarksValue;
            }
            // Ensure requestedEquipmentIds is set if not already by parsing logic
            if (!updateData.requestedEquipmentIds) {
                 updateData.requestedEquipmentIds = [];
            }
        } else {
            updateData.dataRequested = false;
            updateData.dataRequestRemarks = null;
            updateData.dataRequestStatus = null;
            updateData.requestedEquipmentIds = []; // Clear if data is not requested
        }
        
        // Ensure borrowStatus is always set before the final update
        updateData.borrowStatus = BorrowStatus.PENDING_RETURN;

        console.log(`API /request-return PATCH (borrowId: ${borrowId}) - Prisma update data:`, JSON.stringify(updateData, null, 2));

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
            data: updateData,
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