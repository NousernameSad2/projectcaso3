import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus, UserRole, DeficiencyStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Prisma } from '@prisma/client';

// GET: Fetch borrow records with PENDING_RETURN status for Staff/Faculty dashboard
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);

    // 1. Authentication & Authorization: Ensure user is Staff/Faculty/Admin
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const userRole = session.user.role as UserRole;
    const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY]; // Add ADMIN later if needed

    if (!userRole || !allowedRoles.includes(userRole)) {
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    try {
        // --- START: Build Prisma Where Clause with Role-Based Filtering ---
        let whereClause: Prisma.BorrowWhereInput = {
            borrowStatus: BorrowStatus.PENDING_RETURN, // Base filter
        };

        // *** NEW: Add FIC filtering for FACULTY role ***
        if (userRole === UserRole.FACULTY) {
            whereClause.class = {
                ficId: userId // Only show borrows where the class's ficId matches the faculty's ID
            };
        }
        // STAFF sees all pending returns
        // --- END: Build Prisma Where Clause ---

        // 2. Fetch borrow records using the constructed where clause
        const pendingReturns = await prisma.borrow.findMany({
            where: whereClause, // Apply the role-based where clause
            // Use include to get all scalar Borrow fields + specified relations
            include: {
                equipment: { 
                    select: {
                        id: true,
                        name: true,
                        equipmentId: true,
                        images: true,
                        status: true
                    }
                },
                borrower: { 
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    }
                },
                deficiencies: {
                    where: {
                        status: { not: DeficiencyStatus.RESOLVED }
                    },
                    select: { id: true }
                }
            },
            orderBy: {
                updatedAt: 'asc', // Show oldest pending requests first
            },
        });

        return NextResponse.json(pendingReturns);

    } catch (error) {
        console.error(`API Error - GET /api/borrows/pending-returns:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
