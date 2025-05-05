import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { EquipmentStatus } from '@prisma/client';

export async function GET() {
    try {
        const counts = await prisma.equipment.groupBy({
            by: ['status'],
            _count: {
                id: true,
            },
        });

        // Format for chart (e.g., [{ name: 'AVAILABLE', value: 10 }])
        const formattedCounts = counts.map(item => ({
            name: item.status,
            value: item._count.id,
        }));

        return NextResponse.json(formattedCounts);

    } catch (error) {
        console.error('[API_REPORTS_EQUIPMENT_STATUS_COUNTS_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 