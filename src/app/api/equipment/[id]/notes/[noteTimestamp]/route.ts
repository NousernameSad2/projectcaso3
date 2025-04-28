import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function DELETE(request: Request, { params }: { params: { id: string; noteTimestamp: string } }) {
    // Unique log message to verify execution
    console.log(`--- EXECUTION CHECK: src/app/api/equipment/[id]/notes/[noteTimestamp]/route.ts DELETE handler ---`); 

    const session = await getServerSession(authOptions);
    const equipmentId = params.id;
    const noteTimestampToDelete = params.noteTimestamp; // This will likely be an ISO string URL-encoded

    if (!session || !session.user) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Allow STAFF or FACULTY to delete notes
    if (session.user.role !== 'STAFF' && session.user.role !== 'FACULTY') {
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    if (!equipmentId || !noteTimestampToDelete) {
         return NextResponse.json({ message: 'Missing equipment ID or note timestamp' }, { status: 400 });
    }
    
    // Decode the timestamp if it's URL-encoded (it likely will be)
    const decodedTimestamp = decodeURIComponent(noteTimestampToDelete);

    try {
        console.log(`DELETE NOTE API: Attempting findUnique for equipmentId: ${equipmentId}`);
        const equipment = await prisma.equipment.findUnique({
            where: { id: equipmentId },
            select: { customNotesLog: true } // Only select the log initially
        });

        if (!equipment) {
            console.log(`DELETE NOTE API: Equipment not found for ID: ${equipmentId}`);
            return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
        }

        const currentLog = Array.isArray(equipment.customNotesLog) ? equipment.customNotesLog : [];

        // Find the note to delete
        const noteIndex = currentLog.findIndex((note: any) => note.timestamp === decodedTimestamp);

        if (noteIndex === -1) {
            console.log(`DELETE NOTE API: Note with timestamp ${decodedTimestamp} not found on equipment ${equipmentId}`);
            return NextResponse.json({ message: `Note with timestamp ${decodedTimestamp} not found` }, { status: 404 });
        }

        // Create the updated log by filtering out the note
        const updatedLog = currentLog.filter((_: any, index: number) => index !== noteIndex);

        console.log(`DELETE NOTE API: Attempting update for equipmentId: ${equipmentId} to remove note.`);
        await prisma.equipment.update({
            where: { id: equipmentId },
            data: {
                customNotesLog: updatedLog as Prisma.InputJsonValue[],
            },
        });
        console.log(`DELETE NOTE API: Note removal successful for equipmentId: ${equipmentId}`);

        return NextResponse.json({ message: 'Note deleted successfully' }, { status: 200 });

    } catch (error) {
        console.error(`DELETE NOTE API Error - DELETE /api/equipment/${equipmentId}/notes/${decodedTimestamp}:`, error); 
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ message }, { status: 500 });
    }
} 