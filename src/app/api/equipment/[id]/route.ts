import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, EquipmentStatus, UserRole } from '@prisma/client';
import { EquipmentSchema } from '@/lib/schemas'; // Import schema for validation
import { z } from 'zod';
import { getServerSession } from "next-auth/next"; // Added import
import { authOptions } from "@/lib/authOptions"; // Updated import
import { NextRequest } from 'next/server'; // Added NextRequest
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// GET Handler for fetching a single equipment item by ID
export async function GET(
  request: NextRequest, // Changed Request to NextRequest for consistency
  context: { params: Promise<{ id: string }> } // Updated signature
) {
  const session = await getServerSession(authOptions); 
  if (!session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  
  const params = await context.params; // Await context.params
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
              reservationType: true,
              borrower: {
                 select: { id: true, name: true, email: true }
              },
              // *** NEW: Include Class details ***
              class: {
                select: { id: true, courseCode: true, section: true, academicYear: true, semester: true } 
              },
              // *** END NEW ***
              deficiencies: {
                 select: { type: true, description: true }
              },
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
  request: NextRequest, // Changed Request to NextRequest for consistency
  context: { params: Promise<{ id: string }> } // Updated signature
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user.role !== 'STAFF' && session.user.role !== 'FACULTY')) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  
  const params = await context.params; // Await context.params
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
    const { name, equipmentId: bodyEquipmentId, category, condition, status, stockCount, purchaseCost, imageUrl, maintenanceNotes, instrumentManualUrl } = validation.data;

    // Fetch existing equipment to compare status and get current log
    const existingEquipment = await prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { status: true, maintenanceLog: true, equipmentId: true } // Select needed fields
    });
    if (!existingEquipment) {
      return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
    }

    // Prepare data for update
    const updateData: Prisma.EquipmentUpdateInput = {
        name,
        equipmentId: bodyEquipmentId || undefined,
        category,
        condition: condition || undefined,
        status,
        stockCount,
        purchaseCost: purchaseCost,
        images: imageUrl ? [imageUrl] : [],
        instrumentManualUrl: instrumentManualUrl || undefined,
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
        updateData.maintenanceLog = [...currentLog, newLogEntry] as Prisma.InputJsonValue[];
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

  } catch (error: unknown) {
    console.error(`Error updating equipment ${equipmentId}:`, error); 
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Validation error processing request.', errors: error.flatten().fieldErrors }, { status: 400 });
    }
    // Add check for other Prisma errors if needed
    return NextResponse.json({ message: 'An unexpected error occurred.' }, { status: 500 });
  }
}

// DELETE: "Delete" an equipment record by archiving it or permanently deleting if already archived
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) { // Updated signature
  const session = await getServerSession(authOptions);
  const userRole = session?.user?.role as UserRole;
  if (!session?.user || !(userRole === UserRole.STAFF || userRole === UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const params = await context.params; // Await context.params
  const equipmentId = params.id;

  if (!equipmentId) {
    return NextResponse.json({ message: 'Equipment ID is missing' }, { status: 400 });
  }

  try {
    // Check if equipment exists first
    const equipment = await prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { id: true, status: true } 
    });

    if (!equipment) {
      return NextResponse.json({ message: 'Equipment not found' }, { status: 404 });
    }

    if (equipment.status === EquipmentStatus.ARCHIVED) {
      // If already archived, permanently delete.
      // The Prisma schema change (onDelete: SetNull) handles associated borrows by setting their equipmentId to null.
      await prisma.equipment.delete({
        where: { id: equipmentId },
      });
      console.log(`Equipment ${equipmentId} permanently deleted by ${session.user.email}.`);
      // Return success with OK status and a message
      return NextResponse.json({ message: 'Equipment permanently deleted' }, { status: 200 });
    } else {
      // If not archived, update the equipment status to ARCHIVED
      await prisma.equipment.update({
        where: { id: equipmentId },
        data: { status: EquipmentStatus.ARCHIVED },
      });
      console.log(`Equipment ${equipmentId} archived by ${session.user.email}.`);
      // Return success with No Content status (standard for Archive)
      return new NextResponse(null, { status: 204 });
    }

  } catch (error: unknown) {
    console.error(`API Error - DELETE /api/equipment/${equipmentId}:`, error);

    // Specific check for Record Not Found during the initial findUnique, update, or delete
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ message: 'Equipment not found' }, { status: 404 });
    }

    // Fallback for other errors
    return NextResponse.json({ message: 'Internal Server Error processing delete request' }, { status: 500 });
  }
}

// Keep the POST handler in the main route file (src/app/api/equipment/route.ts)
// This file only handles routes like /api/equipment/some-id 