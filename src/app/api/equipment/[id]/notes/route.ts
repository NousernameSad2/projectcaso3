import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const noteSchema = z.object({
    noteText: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
    // Unique log message to verify execution
    console.log("--- EXECUTION CHECK: src/app/api/equipment/[id]/notes/route.ts POST handler ---"); 

    // Get session first
    const session = await getServerSession(authOptions);
    
    // Now it's safe to access params.id
    const equipmentId = params.id; 

    if (!session || !session.user) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    if (session.user.role !== 'STAFF' && session.user.role !== 'FACULTY') {
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    let validatedData;
    try {
        validatedData = noteSchema.parse(await request.json());
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ message: 'Invalid input.', errors: error.flatten().fieldErrors }, { status: 400 });
        }
        return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
    }

    try {
        console.log(`NOTES API: Attempting findUnique for equipmentId: ${equipmentId}`);
        const equipment = await prisma.equipment.findUnique({
            where: { id: equipmentId },
        });

        if (!equipment) {
            console.log(`NOTES API: Equipment not found for ID: ${equipmentId}`);
            return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
        }

        console.log(`NOTES API: Found equipment. Preparing note for userId: ${session.user.id}`);
        const newNote = {
            timestamp: new Date().toISOString(),
            userId: session.user.id, 
            userDisplay: session.user.name || session.user.email || 'Unknown Admin',
            text: validatedData.noteText,
        };

        // Ensure currentLog is handled correctly even if null/undefined initially
        const currentLog = Array.isArray(equipment.customNotesLog) ? equipment.customNotesLog : [];
        const updatedLog = [...currentLog, newNote];
        
        console.log(`NOTES API: Attempting update for equipmentId: ${equipmentId} with new log entry.`);
        await prisma.equipment.update({
            where: { id: equipmentId },
            data: {
                customNotesLog: updatedLog as Prisma.InputJsonValue[],
            },
        });
        console.log(`NOTES API: Update successful for equipmentId: ${equipmentId}`);

        return NextResponse.json(newNote, { status: 201 });

    } catch (error) {
        // Log the specific equipmentId in case of error for easier debugging
        console.error(`NOTES API Error - POST /api/equipment/${equipmentId}/notes:`, error); 
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ message }, { status: 500 });
    }
}