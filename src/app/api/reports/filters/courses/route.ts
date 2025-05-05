import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const courses = await prisma.class.findMany({
            select: {
                id: true,
                courseCode: true,
                section: true,
                semester: true, // Include semester for better display
                academicYear: true, // Include AY for better display
            },
            orderBy: [
                { academicYear: 'desc' },
                { semester: 'desc' },
                { courseCode: 'asc' },
                { section: 'asc' },
            ],
        });

        // Format for dropdown display
        const formattedCourses = courses.map(c => ({
            id: c.id,
            name: `${c.courseCode} - ${c.section} (${c.semester} ${c.academicYear || ''})`.trim()
        }));

        return NextResponse.json(formattedCourses);
    } catch (error) {
        console.error('[API_REPORTS_FILTERS_COURSES_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 