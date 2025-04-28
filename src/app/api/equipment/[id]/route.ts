import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus } from '@prisma/client';
import { EquipmentSchema } from '@/lib/schemas'; // Import schema for validation
import { z } from 'zod';
import { getServerSession } from "next-auth/next"; // Added import
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; // Added import

const prisma = new PrismaClient();

// GET Handler for fetching a single equipment item by ID
export async function GET(
  request: Request, 
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions); 
  if (!session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  
  // Access params.id after await
  const equipmentId = params.id; 

  if (!equipmentId) {
    return NextResponse.json({ message: 'Equipment ID is required' }, { status: 400 });
  }

  try {
    const equipment = await prisma.equipment.findUnique({
      where: { id: equipmentId }, // Use variable
      // Include count of RETURNED or COMPLETED borrows only
      include: {
        _count: {
          select: {
            borrowRecords: {
              where: { 
                borrowStatus: { 
                  in: [BorrowStatus.RETURNED, BorrowStatus.COMPLETED] 
                }
              },
            },
          },
        },
        // Include borrow records for the activity log
        // Include necessary fields from the related User (borrower)
        borrowRecords: {
          select: {
              id: true,
              borrowStatus: true,
              checkoutTime: true,
              actualReturnTime: true,
              requestSubmissionTime: true,
              // Add missing time fields needed for logs
              requestedStartTime: true,
              requestedEndTime: true,
              approvedStartTime: true,
              approvedEndTime: true,
              // Select nested borrower fields directly
              borrower: {
                 select: { id: true, name: true, email: true }
              },
              // Select nested deficiency fields directly
              deficiencies: {
                 select: { type: true, description: true }
              },
              // Select nested approver fields directly
              approvedByFic: {
                select: { id: true, name: true, email: true }
              },
              approvedByStaff: {
                select: { id: true, name: true, email: true }
              },
              // Include updatedAt to potentially use as approval/rejection timestamp
              updatedAt: true 
          },
          orderBy: {
            requestSubmissionTime: "desc"
          }
        },
        // maintenanceLog, editHistory, and customNotesLog are JSON fields fetched by default when using include
      },
    });

    if (!equipment) {
      // Use variable in potential message if needed, though not strictly necessary here
      return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
    }

    // The result now includes _count: { borrowRecords: number }
    return NextResponse.json(equipment);

  } catch (error) {
    // Use variable in error logging
    console.error(`Error fetching equipment ${equipmentId}:`, error); 
    // Distinguish between not found and other errors if Prisma throws
    if (error instanceof Error && error.message.includes("not found")) { // Basic check
         // Use variable in potential message if needed
         return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
    }
    return NextResponse.json({ message: 'Failed to fetch equipment' }, { status: 500 });
  }
}

// PUT Handler for updating equipment by ID
export async function PUT(
  request: Request, 
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user.role !== 'STAFF' && session.user.role !== 'FACULTY')) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  
  const equipmentId = params.id; 
  
  try {
    const body = await request.json();

    // Add maintenanceNotes to the schema validation (optional string)
    const ExtendedEquipmentSchema = EquipmentSchema.extend({
        maintenanceNotes: z.string().optional(),
    });

    // Validate incoming data including notes
    const validation = ExtendedEquipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { message: 'Invalid input data.', errors: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Destructure validated data, including notes
    const { name, equipmentId: bodyEquipmentId, category, condition, status, stockCount, purchaseCost, imageUrl, maintenanceNotes } = validation.data;

    // Fetch existing equipment to compare status and get current log
    const existingEquipment = await prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { status: true, maintenanceLog: true, equipmentId: true } // Select needed fields
    });
    if (!existingEquipment) {
      return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
    }

    // Prepare data for update
    const updateData: any = {
        name,
        equipmentId: bodyEquipmentId || null,
        category,
        condition: condition || null,
        status,
        stockCount,
        purchaseCost: purchaseCost,
        images: imageUrl ? [imageUrl] : [],
    };
    
    // Check if status is changing TO Under Maintenance
    if (status === 'UNDER_MAINTENANCE' && existingEquipment.status !== 'UNDER_MAINTENANCE') {
        const newLogEntry = {
            timestamp: new Date().toISOString(),
            notes: maintenanceNotes || 'Status set to Under Maintenance', // Use provided notes or default
            user: session.user.name || session.user.email, // Log the user who made the change
            type: 'MAINTENANCE' // Add a type field for clarity
        };

        // Ensure existing log is an array
        const currentLog = Array.isArray(existingEquipment.maintenanceLog) ? existingEquipment.maintenanceLog : [];
        // Add the new entry
        updateData.maintenanceLog = [...currentLog, newLogEntry];
    }

    // Optional: Check for equipment ID conflict (no change here)
    if (bodyEquipmentId && bodyEquipmentId !== existingEquipment.equipmentId) {
      const conflictingEquipment = await prisma.equipment.findUnique({
        where: { equipmentId: bodyEquipmentId },
      });
      if (conflictingEquipment) {
        return NextResponse.json(
          { message: 'Equipment ID already exists.', errors: { equipmentId: ['This ID is already in use.'] } },
          { status: 409 } // Conflict
        );
      }
    }

    // Update equipment record with combined data
    const updatedEquipment = await prisma.equipment.update({
      where: { id: equipmentId }, 
      data: updateData,
    });

    console.log(`Equipment updated successfully: ${updatedEquipment.id}`);
    return NextResponse.json(updatedEquipment, { status: 200 });

  } catch (error) {
    console.error(`Error updating equipment ${equipmentId}:`, error); 
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Validation error processing request.', errors: error.flatten().fieldErrors }, { status: 400 });
    }
    // Add check for other Prisma errors if needed
    return NextResponse.json({ message: 'An unexpected error occurred.' }, { status: 500 });
  }
}

// DELETE Handler for deleting equipment by ID
export async function DELETE(
  request: Request, 
  { params }: { params: { id: string } }
) {
  // TODO: Add await for session/auth check if needed here
  // const session = await getServerSession(authOptions); // Example
  // if (!session || session.user.role !== 'STAFF') return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  
  // Access params.id after potential await (if added above) or just use directly if no await is planned
  const equipmentId = params.id;
  
  try {
    // Optional: Check if equipment exists before deleting (provides specific 404)
    const existingEquipment = await prisma.equipment.findUnique({
      where: { id: equipmentId }, // Use variable
    });
    if (!existingEquipment) {
      return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
    }

    // Delete the equipment record
    await prisma.equipment.delete({
      where: { id: equipmentId }, // Use variable
    });

    console.log(`Equipment deleted successfully: ${equipmentId}`); // Use variable
    // Return No Content on successful deletion
    return new NextResponse(null, { status: 204 }); 

  } catch (error) {
    // Use variable in error logging
    console.error(`Error deleting equipment ${equipmentId}:`, error); 
    // Handle potential errors, e.g., if the delete fails due to constraints
    // or if the findUnique check was skipped and delete fails.
    // Add check for specific Prisma errors if needed
    // if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') { // Record not found
    //   return NextResponse.json({ message: 'Equipment not found' }, { status: 404 });
    // }
    return NextResponse.json({ message: 'An unexpected error occurred during deletion.' }, { status: 500 });
  }
}

// Keep the POST handler in the main route file (src/app/api/equipment/route.ts)
// This file only handles routes like /api/equipment/some-id 