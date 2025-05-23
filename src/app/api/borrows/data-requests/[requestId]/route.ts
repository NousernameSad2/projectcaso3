import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import { z } from 'zod';
import fs from 'fs/promises'; // For file system operations
import path from 'path'; // For path manipulation

// Schema for validating status update
const updateStatusSchema = z.object({
  status: z.string().min(1, { message: "Status is required" }), // Add more specific status enum validation if needed
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params; // Await the params
    const { requestId } = params; // Destructure after awaiting

    if (!session?.user?.id || (session.user.role !== UserRole.STAFF && session.user.role !== UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions.' }, { status: 403 });
    }

    if (!requestId) {
        return NextResponse.json({ message: 'Request ID is required' }, { status: 400 });
    }

    try {
        const body = await req.json();
        const parsedBody = updateStatusSchema.safeParse(body);

        if (!parsedBody.success) {
            return NextResponse.json({ message: 'Invalid input', errors: parsedBody.error.flatten().fieldErrors }, { status: 400 });
        }

        const { status: newStatus } = parsedBody.data;

        const updatedRequest = await prisma.borrow.update({
            where: {
                id: requestId,
                dataRequested: true, // Ensure we are updating a data request
            },
            data: {
                dataRequestStatus: newStatus,
            },
        });

        if (!updatedRequest) {
            return NextResponse.json({ message: 'Data request not found or not eligible for update.' }, { status: 404 });
        }

        return NextResponse.json(updatedRequest);
    } catch (error) {
        console.error(`API Error - PATCH /api/borrows/data-requests/${requestId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
    const session = await getServerSession(authOptions);
    const params = await context.params;
    const { requestId } = params;

    if (!session?.user?.id || (session.user.role !== UserRole.STAFF && session.user.role !== UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions.' }, { status: 403 });
    }

    if (!requestId) {
        return NextResponse.json({ message: 'Request ID is required' }, { status: 400 });
    }

    try {
        // First, retrieve the data request to get the list of files
        const borrowRequest = await prisma.borrow.findUnique({
            where: {
                id: requestId,
                dataRequested: true, // Ensure we are acting on an active data request
            },
            select: { dataFiles: true },
        });

        if (!borrowRequest) {
            return NextResponse.json({ message: 'Data request not found or already processed/cancelled.' }, { status: 404 });
        }

        const filesToDelete = (borrowRequest.dataFiles || []) as { id: string; name: string; url: string }[];

        // Delete files from disk
        if (filesToDelete.length > 0) {
            const baseUploadDir = path.join(process.cwd(), 'public', 'uploads', 'data_requests', requestId);
            for (const file of filesToDelete) {
                const filePathOnDisk = path.join(baseUploadDir, file.name);
                try {
                    await fs.unlink(filePathOnDisk);
                    console.log(`Deleted file ${filePathOnDisk} as part of data request cancellation.`);
                } catch (fileError: any) {
                    if (fileError.code === 'ENOENT') {
                        console.warn(`File ${filePathOnDisk} not found during data request cancellation (already deleted?).`);
                    } else {
                        // Log error but continue to attempt to cancel the request in the DB
                        // A more robust solution might involve a multi-step transaction or a retry mechanism
                        console.error(`Failed to delete file ${filePathOnDisk} during data request cancellation:`, fileError);
                        // Optionally, you could decide to halt the entire cancellation if a file can't be deleted.
                        // For now, we log and proceed to avoid a partial state where DB is not updated.
                    }
                }
            }
        }

        // Now, update the borrow record to cancel the data request
        const updatedBorrow = await prisma.borrow.update({
            where: {
                id: requestId,
                // No need to re-check dataRequested: true here, as we fetched based on it.
            },
            data: {
                dataRequested: false,
                dataRequestRemarks: null,
                dataRequestStatus: null, // Or a specific status like 'CANCELLED_BY_ADMIN'
                dataFiles: [], // Clear file metadata from the database
            },
        });

        // No need to check !updatedBorrow here again, as prisma.borrow.update would throw if not found after the initial findUnique.

        return NextResponse.json({ message: 'Data request cancelled successfully and associated files deleted.' }, { status: 200 });
    } catch (error) {
        console.error(`API Error - DELETE /api/borrows/data-requests/${requestId}:`, error);
        // It's good practice to check the instance of error if you have specific Prisma error codes to handle
        // For example, PrismaClientKnownRequestError for P2025 (Record to update not found)
        if (error instanceof Error && (error as any).code === 'P2025') { // Prisma's Record Not Found error
             return NextResponse.json({ message: 'Data request not found when attempting to update.' }, { status: 404 });
        }
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 