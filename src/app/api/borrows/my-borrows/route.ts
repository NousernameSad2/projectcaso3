import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Ensure this path is correct
import { BorrowStatus } from '@prisma/client';

// Define active statuses explicitly for type safety
const activeStatuses: BorrowStatus[] = [
    BorrowStatus.OVERDUE,
    BorrowStatus.ACTIVE,
    BorrowStatus.PENDING_RETURN,
    BorrowStatus.APPROVED,
    BorrowStatus.PENDING,
];

// Helper function to determine if a status is considered active
const isActiveStatus = (status: BorrowStatus): boolean => {
    return activeStatuses.includes(status);
};

// GET: Fetch all borrow records for the currently logged-in user
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);

    // 1. Authentication: Ensure user is logged in
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        // --- START: Find User Group IDs (NEW) --- 
        const userGroupMemberships = await prisma.borrowGroupMate.findMany({
            where: { userId: userId },
            select: { borrowGroupId: true }
        });
        const userGroupIds: string[] = [...new Set(userGroupMemberships.map(mem => mem.borrowGroupId))];
        // --- END: Find User Group IDs ---

        // --- START: Update Overdue Status --- 
        // Note: This now updates overdue status for items where the user is the borrower OR a groupmate
        // We might want to limit this update ONLY to items where user is the borrowerId if that's desired.
        // For now, updating for all visible items seems reasonable.
        const now = new Date();
        await prisma.borrow.updateMany({
            where: {
                OR: [
                    { borrowerId: userId },
                    { borrowGroupId: { in: userGroupIds, not: null } }
                ],
                borrowStatus: BorrowStatus.ACTIVE,
                approvedEndTime: { lt: now } // Check against approved end time
            },
            data: {
                borrowStatus: BorrowStatus.OVERDUE,
            },
        });
        // --- END: Update Overdue Status --- 

        // 2. Fetch borrow records for the user (now including potentially updated OVERDUE ones)
        //    AND items where the user is a groupmate (MODIFIED)
        const borrows = await prisma.borrow.findMany({
            where: {
                OR: [
                    { borrowerId: userId }, // User is the direct borrower
                    { 
                        borrowGroupId: { 
                            in: userGroupIds, // Borrow belongs to a group the user is a member of
                            not: null 
                        }
                    }
                ]
                // No status filter here, fetch all related borrows (active and inactive)
            },
            select: { // Use select to be explicit about all needed fields
                // Include all scalar fields from Borrow model that are needed
                id: true,
                borrowStatus: true,
                borrowerId: true,
                borrowGroupId: true,
                requestedStartTime: true,
                requestedEndTime: true,
                requestSubmissionTime: true,
                approvedEndTime: true,
                checkoutTime: true, // Explicitly include checkoutTime
                actualReturnTime: true, // Explicitly include actualReturnTime
                returnCondition: true, // Include return condition/remarks if needed
                returnRemarks: true,
                equipmentId: true,
                classId: true,
                approvedByFicId: true,
                approvedByStaffId: true,
                approvedStartTime: true,
                // Include nested relations
                equipment: {
                    select: {
                        id: true,
                        name: true,
                        equipmentId: true,
                        images: true,
                    }
                },
                class: {
                    select: {
                        id: true,
                        courseCode: true,
                        section: true,
                        semester: true,
                        academicYear: true
                    }
                }
                // Add other fields from Borrow if necessary
            },
            // Initial sort by request submission time
            orderBy: {
                requestSubmissionTime: 'desc',
            },
        });

        // Sort in application code to prioritize active statuses
        borrows.sort((a, b) => {
            const aIsActive = isActiveStatus(a.borrowStatus);
            const bIsActive = isActiveStatus(b.borrowStatus);

            if (aIsActive && !bIsActive) return -1; // a comes first
            if (!aIsActive && bIsActive) return 1;  // b comes first

            // If both are active or both are inactive, sort differently
            if (aIsActive) {
                // Both active: sort by requestedStartTime ascending
                return new Date(a.requestedStartTime).getTime() - new Date(b.requestedStartTime).getTime();
            } else {
                // Both inactive: sort by requestSubmissionTime descending
                return new Date(b.requestSubmissionTime).getTime() - new Date(a.requestSubmissionTime).getTime();
            }
        });

        return NextResponse.json(borrows);

    } catch (error) {
        console.error(`API Error - GET /api/borrows/my-borrows:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 