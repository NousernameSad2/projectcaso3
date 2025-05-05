import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const equipment = await prisma.equipment.findMany({
            select: {
                id: true,
                name: true,
            },
            orderBy: {
                name: 'asc',
            },
        });
        
        // The structure {id, name} is already suitable for the dropdown
        return NextResponse.json(equipment);
    } catch (error) {
        console.error('[API_REPORTS_FILTERS_EQUIPMENT_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 