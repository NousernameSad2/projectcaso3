import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { BorrowStatus, UserRole, Prisma } from '@prisma/client';

interface RouteContext {
    params: {
        id: string; // Represents classId
    }
}

// GET: Fetch group borrow records for a specific class
export async function GET(req: NextRequest, { params }: RouteContext) {
    const session = await getServerSession(authOptions);
    // Allow any authenticated user to view class borrow history
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const userId = session.user.id;
    const classId = params.id;

    if (!classId) {
        return NextResponse.json({ message: 'Class ID is required' }, { status: 400 });
    }

    try {
        // Find borrow records linked to this classId where borrowGroupId is not null
        const groupBorrows = await prisma.borrow.findMany({
            where: {
                classId: classId,
                borrowGroupId: { 
                    not: null 
                },
                // Optionally filter by status? e.g., only completed/returned?
                // borrowStatus: { in: [BorrowStatus.RETURNED, BorrowStatus.COMPLETED] }
            },
            select: {
                // Select fields needed for the history display
                id: true,
                borrowGroupId: true,
                requestSubmissionTime: true,
                checkoutTime: true,
                actualReturnTime: true,
                borrowStatus: true,
                reservationType: true, // Include purpose
                equipment: { 
                    select: { id: true, name: true, equipmentId: true, images: true }
                },
                borrower: { 
                    select: { id: true, name: true, email: true }
                },
                // No need to select class again, we are filtering by it
            },
            orderBy: [
                // Order groups by the latest activity (e.g., return time, then checkout time)
                { actualReturnTime: 'desc' }, 
                { checkoutTime: 'desc' },
                { requestSubmissionTime: 'desc' },
            ],
        });

        return NextResponse.json(groupBorrows);

    } catch (error) {
        console.error(`API Error - GET /api/classes/${classId}/borrows:`, error);
        return NextResponse.json({ message: 'Internal Server Error fetching class borrow history.' }, { status: 500 });
    }
} 