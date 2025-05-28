import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import

// Helper to verify if the logged-in user is STAFF
async function verifyStaffRole() {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return { authorized: false, response: NextResponse.json({ message: 'Authentication required' }, { status: 401 }) };
    }

    const { user: loggedInUser } = session;
    // Allow both STAFF and FACULTY to access this route
    if (loggedInUser.role !== UserRole.STAFF && loggedInUser.role !== UserRole.FACULTY) {
        // If a non-staff/faculty tries to access, it's forbidden, regardless of whether it's their own ID or not.
        return { authorized: false, response: NextResponse.json({ message: 'Forbidden: Insufficient permissions' }, { status: 403 }) };
    }

    return { authorized: true, response: null };
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const params = await context.params;
    const facultyId = params.id;

    const authResult = await verifyStaffRole();
    if (!authResult.authorized) {
        if (authResult.response) { // Explicitly check non-null for TS
            return authResult.response;
        }
        // This case should ideally not be reached if verifyStaffRole ensures a response when not authorized.
        return NextResponse.json({ message: 'Authorization check failed unexpectedly.' }, { status: 500 });
    }

    if (!facultyId) {
        return NextResponse.json({ message: 'Faculty ID parameter is missing.' }, { status: 400 });
    }

    console.log(`[API /users/${facultyId}/faculty-borrows] Fetching borrows for Faculty ${facultyId}... (Requested by Staff)`);

    try {
        // Optional: Verify the target user is indeed a FACULTY
        const facultyUser = await prisma.user.findUnique({
            where: { id: facultyId },
            select: { role: true },
        });

        if (!facultyUser) {
            return NextResponse.json({ message: 'Faculty user not found.' }, { status: 404 });
        }
        if (facultyUser.role !== UserRole.FACULTY) {
            return NextResponse.json({ message: 'Target user is not a Faculty member.' }, { status: 400 });
        }

        // 1. Find classes where the current facultyId is the FIC
        const facultyClasses = await prisma.class.findMany({
            where: {
                ficId: facultyId,
            },
            select: {
                id: true, // Select only the class IDs
            },
        });

        const facultyClassIds = facultyClasses.map(cls => cls.id);

        if (facultyClassIds.length === 0) {
            console.log(`[API /users/${facultyId}/faculty-borrows] Faculty ${facultyId} has no assigned classes. Returning empty list.`);
            return NextResponse.json([]);
        }

        console.log(`[API /users/${facultyId}/faculty-borrows] Faculty ${facultyId} is FIC for classes:`, facultyClassIds);

        // 2. Fetch borrows associated with these classes
        // This is similar to /api/users/me/faculty-borrows but for a specific facultyId
        const facultyRelatedBorrows = await prisma.borrow.findMany({
            where: {
                classId: {
                    in: facultyClassIds,
                },
                // Optional: Add status filters if you only want certain statuses for this view
                // e.g., borrowStatus: { in: [BorrowStatus.PENDING, BorrowStatus.APPROVED, BorrowStatus.ACTIVE] }
            },
            include: {
                equipment: { 
                    select: { id: true, name: true, equipmentId: true, images: true, status: true }
                },
                borrower: { 
                    select: { id: true, name: true, email: true } // User who borrowed
                },
                class: { 
                    select: { id: true, courseCode: true, section: true, academicYear: true, semester: true } 
                },
                 _count: { // For potential display of deficiency counts on borrows
                     select: { deficiencies: true }
                 }
            },
            orderBy: [
                { requestSubmissionTime: 'desc' }, // Example: newest requests first
                { borrowStatus: 'asc' }, 
            ],
        });

        console.log(`[API /users/${facultyId}/faculty-borrows] Found ${facultyRelatedBorrows.length} borrows related to faculty ${facultyId}'s classes.`);
        return NextResponse.json(facultyRelatedBorrows);

    } catch (error) {
        console.error(`API Error - GET /api/users/${facultyId}/faculty-borrows:`, error);
        // Handle Prisma errors specifically if needed, e.g., P2025 (Record not found)
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            // Specific Prisma error codes can be handled here
            if (error.code === 'P2023') { // Invalid UUID string
                 return NextResponse.json({ message: `Invalid Faculty ID format: ${facultyId}` }, { status: 400 });
            }
        }
        return NextResponse.json({ message: 'Internal Server Error fetching faculty-related borrows.' }, { status: 500 });
    }
} 