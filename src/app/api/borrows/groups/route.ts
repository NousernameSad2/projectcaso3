import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

// GET: Fetch all borrow records that are part of a group
export async function GET() {
    const session = await getServerSession(authOptions);

    // 1. Authentication & Authorization: Ensure user is STAFF or FACULTY
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized: Session not found.' }, { status: 401 });
    }
    const userId = session.user.id;
    const userRole = session.user.role as UserRole;

    if (userRole !== UserRole.STAFF && userRole !== UserRole.FACULTY) {
        console.warn(`User ${userId} with role ${userRole} attempted to access borrow groups.`);
        return NextResponse.json({ message: 'Forbidden: Access restricted to Staff/Faculty.' }, { status: 403 });
    }

    console.log(`[API /borrows/groups] Fetching all group borrows for user ${userId}...`);

    try {
        // Define common includes for borrow details
        const commonBorrowIncludes = {
            equipment: { 
                select: { id: true, name: true, equipmentId: true, images: true, status: true }
            },
            borrower: { 
                select: { id: true, name: true, email: true }
            },
            class: { 
                select: { id: true, courseCode: true, section: true, academicYear: true, semester: true } 
            },
            // Add other relations if needed for the log view
        };

        // Fetch all borrow records that have a non-null borrowGroupId
        const groupBorrows = await prisma.borrow.findMany({
            where: {
                borrowGroupId: { 
                    not: null 
                },
                // Optional: Add filters based on query params? (e.g., status, date range)
            },
            include: commonBorrowIncludes,
            orderBy: [
                // Order primarily by group ID, then by request time within the group?
                { borrowGroupId: 'desc' }, // Show newest groups first
                { requestSubmissionTime: 'asc' },
            ],
        });

        // The frontend will handle the grouping logic based on borrowGroupId
        console.log(`[API /borrows/groups] Found ${groupBorrows.length} borrow records belonging to groups.`);
        return NextResponse.json(groupBorrows);

    } catch (error) {
        console.error(`API Error - GET /api/borrows/groups for user ${userId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error fetching group borrows.' }, { status: 500 });
    }
} 