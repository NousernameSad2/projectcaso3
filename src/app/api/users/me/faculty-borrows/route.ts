import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

// GET: Fetch borrow records linked to classes the logged-in faculty is FIC for
export async function GET() {
    const session = await getServerSession(authOptions);

    // 1. Authentication & Authorization: Ensure user is FACULTY
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized: Session not found.' }, { status: 401 });
    }
    const userId = session.user.id;
    const userRole = session.user.role as UserRole;

    if (userRole !== UserRole.FACULTY) {
        console.warn(`User ${userId} with role ${userRole} attempted to access faculty-borrows.`);
        return NextResponse.json({ message: 'Forbidden: Access restricted to Faculty.' }, { status: 403 });
    }

    console.log(`[API /users/me/faculty-borrows] Fetching borrows for Faculty ${userId}...`);

    try {
        // 2. Find classes where the current user is the FIC
        const facultyClasses = await prisma.class.findMany({
            where: {
                ficId: userId,
                // Optionally filter by isActive status if needed for this view
                // isActive: true, 
            },
            select: {
                id: true, // Select only the class IDs
            },
        });

        const facultyClassIds = facultyClasses.map(cls => cls.id);

        if (facultyClassIds.length === 0) {
            console.log(`[API /users/me/faculty-borrows] Faculty ${userId} has no assigned classes. Returning empty list.`);
            return NextResponse.json([]); // Return empty array if no classes assigned
        }

        console.log(`[API /users/me/faculty-borrows] Faculty ${userId} is FIC for classes:`, facultyClassIds);

        // 3. Fetch borrows associated with these classes
        const facultyRelatedBorrows = await prisma.borrow.findMany({
            where: {
                classId: {
                    in: facultyClassIds,
                },
                // Optional: Add status filters if you only want certain statuses (e.g., PENDING, APPROVED, ACTIVE)
                // borrowStatus: { in: [BorrowStatus.PENDING, BorrowStatus.APPROVED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE] }
            },
            include: {
                equipment: { 
                    select: { id: true, name: true, equipmentId: true, images: true, status: true }
                },
                borrower: { 
                    select: { id: true, name: true, email: true }
                },
                class: { 
                    select: { id: true, courseCode: true, section: true, academicYear: true, semester: true } 
                },
                 // Include deficiencies count or details if needed
                 _count: {
                     select: { deficiencies: true }
                 }
            },
            orderBy: [
                // Example ordering: newest requests first, then by status
                { requestSubmissionTime: 'desc' },
                { borrowStatus: 'asc' }, 
            ],
        });

        console.log(`[API /users/me/faculty-borrows] Found ${facultyRelatedBorrows.length} borrows related to faculty ${userId}'s classes.`);
        return NextResponse.json(facultyRelatedBorrows);

    } catch (error) {
        console.error(`API Error - GET /api/users/me/faculty-borrows for user ${userId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error fetching faculty-related borrows.' }, { status: 500 });
    }
} 