import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";

// This interface is not used in this file anymore and can be removed.
// interface EquipmentDetailForDataRequest {
//   id: string;
//   name: string | null;
//   equipmentId: string | null;
//   isDataGenerating: boolean;
//   images?: string[] | null;
// }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !(session.user.role === UserRole.STAFF || session.user.role === UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
        // Reverted to simpler fetch for the /borrow-requests page
        // This ensures equipment is a single object as expected by DataRequestAdminView
        const dataRequests = await prisma.borrow.findMany({
            where: { 
                dataRequested: true 
            },
            include: {
                borrower: { select: { name: true, email: true, id: true } },
                // equipment is a single object relation here
                equipment: { 
                    select: { 
                        id: true, 
                        name: true, 
                        equipmentId: true,
                        // isDataGenerating might not be on the original DataRequestAdminView.equipment type
                        // but including it here is fine if the type on borrow-requests page can ignore it.
                        // For safety, let's stick to what DataRequestAdminView strictly defines for equipment:
                        // equipment: { id: string; name: string; equipmentId: string | null } | null;
                        // So, isDataGenerating and images should not be selected here for this endpoint.
                    } 
                }, 
            },
            orderBy: { updatedAt: 'desc' },
        });

        return NextResponse.json(dataRequests);

    } catch (error) {
        console.error("Error fetching data requests for /borrow-requests:", error);
        return NextResponse.json({ message: 'Error fetching data requests', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}

// PATCH and POST (for upload) handlers would remain here if they were part of this route originally
// Based on the problem description, PATCH /api/borrows/data-requests/[requestId] and 
// POST /api/borrows/data-requests/[requestId]/upload are separate dynamic routes.
// So, this file should likely only contain the GET for the list. 