import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';

// GET handler to fetch borrow history for a specific user ID (Admin only)
export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    const requestingUser = session?.user;
    const targetUserId = params.userId;

    // Authorization: Ensure user is logged in and is STAFF or FACULTY
    if (!requestingUser) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    if (requestingUser.role !== UserRole.STAFF && requestingUser.role !== UserRole.FACULTY) {
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    if (!targetUserId) {
        return NextResponse.json({ message: 'User ID parameter is missing' }, { status: 400 });
    }

    try {
        // Check if the target user exists
        const targetUserExists = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true }
        });
        if (!targetUserExists) {
            return NextResponse.json({ message: 'Target user not found' }, { status: 404 });
        }

        // --- START: Find Target User Group IDs --- 
        const userGroupMemberships = await prisma.borrowGroupMate.findMany({
            where: { userId: targetUserId },
            select: { borrowGroupId: true }
        });
        const userGroupIds: string[] = [...new Set(userGroupMemberships.map(mem => mem.borrowGroupId))];
        // --- END: Find Target User Group IDs ---

        // Fetch borrow history where user is borrower OR groupmate
        const borrowHistory = await prisma.borrow.findMany({
            where: {
                 OR: [
                    { borrowerId: targetUserId }, // User is the direct borrower
                    { 
                        borrowGroupId: { 
                            in: userGroupIds, // Borrow belongs to a group the user is a member of
                            not: null 
                        }
                    }
                ]
            },
            include: {
                equipment: {
                    select: {
                        name: true,
                        equipmentId: true,
                        images: true,
                    }
                },
                // Include other relations if needed by the frontend display
                 // Add groupMates if you want to display them on the page
                // groupMates: { include: { user: { select: { id: true, name: true } } } }
            },
            orderBy: [
                // Consistent sorting: maybe by request time or return time
                { actualReturnTime: 'desc' }, 
                { requestSubmissionTime: 'desc' }
            ],
        });

        // Return the combined history
        return NextResponse.json(borrowHistory);

    } catch (error) {
        console.error(`Error fetching borrow history for user ${targetUserId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 