import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";

// Define the shape of equipment details we expect for the dashboard panel
interface EquipmentDetailForDataRequest {
  id: string;
  name: string | null;
  equipmentId: string | null;
  images?: string[] | null;
}

// This is the new endpoint for the Admin Dashboard Data Request Panel
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) { 
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !(session.user.role === UserRole.STAFF || session.user.role === UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
        const rawDataRequests = await prisma.borrow.findMany({
            where: { 
                dataRequested: true 
            },
            include: {
                borrower: { select: { name: true, email: true, id: true } },
                // Include the primary equipment for context, though we'll build a detailed list
                equipment: { select: { id: true, name: true, equipmentId: true, images: true } }, 
                // Crucially, we need requestedEquipmentIds from the Borrow model itself
            },
            orderBy: { updatedAt: 'desc' },
        });

        const populatedDataRequests = await Promise.all(
            rawDataRequests.map(async (req) => {
                let detailedEquipmentList: EquipmentDetailForDataRequest[] = [];
                
                if (req.requestedEquipmentIds && req.requestedEquipmentIds.length > 0) {
                    const equipmentDetailsFromDb = await prisma.equipment.findMany({
                        where: {
                            id: { in: req.requestedEquipmentIds }
                        },
                        select: { id: true, name: true, equipmentId: true, images: true }
                    });
                    detailedEquipmentList = equipmentDetailsFromDb.map(eq => ({
                        id: eq.id,
                        name: eq.name,
                        equipmentId: eq.equipmentId,
                        images: eq.images,
                    }));
                } else if (req.equipment) { 
                    // If no specific requestedEquipmentIds, but there's a primary equipment, 
                    // and data is requested, populate detailedEquipmentList with this primary one.
                    // This handles cases where data is requested for the single item of the borrow.
                    detailedEquipmentList = [{
                        id: req.equipment.id,
                        name: req.equipment.name,
                        equipmentId: req.equipment.equipmentId,
                        images: req.equipment.images
                    }];
                }
                
                // The main 'equipment' field of the Borrow record (req.equipment) remains as is.
                // We add a new field 'detailedRequestedEquipment' for the list.
                return {
                    ...req, // Spread all original fields from the Borrow record
                    detailedRequestedEquipment: detailedEquipmentList, // Add the new array field
                };
            })
        );

        return NextResponse.json(populatedDataRequests);

    } catch (error) {
        console.error("Error fetching detailed data requests:", error);
        return NextResponse.json({ message: 'Error fetching detailed data requests', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
} 