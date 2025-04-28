import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, UserStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next'; // To potentially check if requester is allowed to see students
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

interface RouteContext {
  params: {
    id: string; // Class ID from the URL
  }
}

// GET: Fetch students enrolled in a specific class
export async function GET(req: NextRequest, { params }: RouteContext) {
    const session = await getServerSession(authOptions);
    // Optional: Add auth check - ensure user is logged in?
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }

    // Access params.id *after* await
    const classId = params.id;

    if (!classId) {
        return NextResponse.json({ message: 'Class ID is required' }, { status: 400 });
    }

    try {
        // Fetch enrollments for the class, including user details
        const enrollments = await prisma.userClassEnrollment.findMany({
            where: {
                classId: classId,
                 // Optionally filter for only ACTIVE students?
                 // user: {
                 //   status: UserStatus.ACTIVE,
                 // }
            },
            include: {
                user: { // Include user details
                    select: {
                        id: true,
                        name: true,
                        email: true, // Keep email for potential display/debugging
                    }
                },
            },
            orderBy: {
                user: { name: 'asc' } // Order by student name
            },
        });

        // Extract just the user data (students)
        // Filter out null users just in case enrollment exists without valid user
        const students = enrollments.map(e => e.user).filter(user => user !== null);

        return NextResponse.json(students);

    } catch (error: any) {
        console.error(`API Error - GET /api/classes/${classId}/students:`, error);
        // Handle specific errors like invalid classId if needed
        return NextResponse.json({ message: 'Internal Server Error fetching students' }, { status: 500 });
    }
} 