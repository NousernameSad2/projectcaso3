import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        const dataRequests = await prisma.borrow.findMany({
            where: {
                borrowerId: userId,
                dataRequested: true, // Only fetch records where data was actually requested
            },
            select: {
                id: true,
                equipment: {
                    select: {
                        name: true,
                        equipmentId: true,
                    },
                },
                requestSubmissionTime: true,
                dataRequestRemarks: true,
                dataRequestStatus: true,
                dataFiles: true, // Array of { id: string, name: string, url: string }
                updatedAt: true, // For sorting or display
            },
            orderBy: {
                requestSubmissionTime: 'desc',
            },
        });

        return NextResponse.json(dataRequests);
    } catch (error) {
        console.error("API Error - GET /api/users/me/data-requests:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 