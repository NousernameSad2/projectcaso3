import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus } from '@prisma/client';

// GET: Fetch recent completed borrow records for a specific piece of equipment
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    console.log(`--- EXECUTION CHECK: src/app/api/equipment/[id]/recent-borrows/route.ts GET handler ---`);
    
    const params = await context.params; // Await params
    const equipmentId = params.id; // Extract equipmentId
    const limit = 5; // Number of recent borrows to fetch
    
    // Example: If we added authentication later, it would go here:
    // const session = await getServerSession(authOptions);
    // if (!session) { ... }

    if (!equipmentId) {
        return NextResponse.json({ message: 'Equipment ID is required' }, { status: 400 });
    }

    try {
        console.log(`RECENT BORROWS API: Fetching for equipmentId: ${equipmentId}`);
        const recentBorrows = await prisma.borrow.findMany({
            where: {
                equipmentId: equipmentId,
                // Fetch only records that are completed/returned
                borrowStatus: {
                    in: [BorrowStatus.RETURNED, BorrowStatus.COMPLETED]
                }
            },
            orderBy: {
                // Order by actual return time, newest first
                actualReturnTime: 'desc'
            },
            take: limit,
            select: {
                id: true,
                actualReturnTime: true,
                borrower: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
        console.log(`RECENT BORROWS API: Found ${recentBorrows.length} records for equipmentId: ${equipmentId}`);

        // Filter out any records where actualReturnTime might be null (shouldn't happen with status filter, but good practice)
        const validBorrows = recentBorrows.filter(borrow => borrow.actualReturnTime);

        return NextResponse.json(validBorrows, { status: 200 });

    } catch (error) {
        console.error(`RECENT BORROWS API Error - GET /api/equipment/${equipmentId}/recent-borrows:`, error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ message }, { status: 500 });
    }
} 