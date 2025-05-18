import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { BorrowStatus } from '@prisma/client';

// GET: Fetch dashboard summary counts for the currently logged-in user
export async function GET() {
    const session = await getServerSession(authOptions);

    // 1. Authentication
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    try {
        // 2. Define statuses to count
        const statusesToCount: BorrowStatus[] = [
            BorrowStatus.PENDING,
            BorrowStatus.APPROVED,
            BorrowStatus.ACTIVE,
            BorrowStatus.OVERDUE,
            BorrowStatus.PENDING_RETURN, // Maybe include this too?
        ];

        // 3. Use groupBy to count borrows by status for the user
        const statusCounts = await prisma.borrow.groupBy({
            by: ['borrowStatus'],
            where: {
                borrowerId: userId,
                borrowStatus: { in: statusesToCount },
            },
            _count: {
                borrowStatus: true,
            },
        });

        // 4. Format the result into a more convenient object
        // Use a Record type for better type safety when indexing. Initialize all statuses.
        const summary: Record<BorrowStatus, number> = {
            [BorrowStatus.PENDING]: 0,
            [BorrowStatus.APPROVED]: 0,
            [BorrowStatus.ACTIVE]: 0,
            [BorrowStatus.OVERDUE]: 0,
            [BorrowStatus.PENDING_RETURN]: 0,
            [BorrowStatus.RETURNED]: 0,
            [BorrowStatus.COMPLETED]: 0,
            [BorrowStatus.REJECTED_FIC]: 0,
            [BorrowStatus.REJECTED_STAFF]: 0,
            [BorrowStatus.CANCELLED]: 0,
            [BorrowStatus.REJECTED_AUTOMATIC]: 0,
        };

        statusCounts.forEach((group) => {
            // Since we initialized all BorrowStatus keys in summary,
            // and Prisma's groupBy returns counts only for existing statuses,
            // this assignment is type-safe.
            summary[group.borrowStatus] = group._count.borrowStatus;
        });
        
        // 5. Filter the summary object to only return the statuses we initially wanted to count
        const filteredSummary: Partial<Record<BorrowStatus, number>> = {};
        statusesToCount.forEach(status => {
            filteredSummary[status] = summary[status];
        });

        // 6. Return the filtered summary
        return NextResponse.json(filteredSummary);

    } catch (error) {
        console.error(`API Error - GET /api/users/dashboard-summary:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 