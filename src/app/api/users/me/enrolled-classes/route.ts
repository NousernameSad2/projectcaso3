import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';

export async function GET() {
    const session = await getServerSession(authOptions);

    // 1. Authentication & Authorization Check
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    if ((session.user.role as UserRole) !== UserRole.REGULAR) { // Cast role as needed
        return NextResponse.json({ message: 'Forbidden: Only REGULAR users can access their enrolled classes.' }, { status: 403 });
    }

    const userId = session.user.id;

    try {
        // 2. Fetch enrolled classes including class details
        const enrollments = await prisma.userClassEnrollment.findMany({
            where: {
                userId: userId,
                class: {
                    isActive: true, // Optionally, only fetch active classes
                },
            },
            include: {
                class: { // Include the related class data
                    select: {
                        id: true,
                        courseCode: true,
                        section: true,
                        semester: true,
                        // Include other class fields if needed in the dropdown display
                    },
                },
            },
            orderBy: { // Optional: Order the classes
                class: {
                    courseCode: 'asc',
                },
            }
        });

        // 3. Extract just the class data for the response
        const enrolledClasses = enrollments.map(enrollment => enrollment.class);

        // 4. Return the classes
        return NextResponse.json(enrolledClasses, { status: 200 });

    } catch (error) {
        console.error('Error fetching enrolled classes:', error);
        return NextResponse.json({ message: 'Error fetching enrolled classes' }, { status: 500 });
    }
} 