import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';

export async function GET() {
    try {
        const fics = await prisma.user.findMany({
            where: {
                role: UserRole.FACULTY, // Filter for Faculty-in-Charge
            },
            select: {
                id: true,
                name: true,
            },
            orderBy: {
                name: 'asc',
            },
        });

        // The structure {id, name} is already suitable for the dropdown
        return NextResponse.json(fics);
    } catch (error) {
        console.error('[API_REPORTS_FILTERS_FICS_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 