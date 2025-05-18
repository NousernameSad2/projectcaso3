import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                // You might want to add role or email if it helps distinguish users in the dropdown
                // For now, just id and name for the filter options.
            },
            orderBy: {
                name: 'asc',
            },
        });

        // The structure {id, name} is already suitable for the FilterOption interface used on the frontend
        return NextResponse.json(users);
    } catch (error) {
        console.error('[API_REPORTS_FILTERS_BORROWERS_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 