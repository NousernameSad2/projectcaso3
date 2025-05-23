import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import fs from 'fs/promises'; // For file system operations
import path from 'path'; // For path manipulation

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
        const body = await req.json();
        const fileIdToDelete = body.fileId as string;

        if (!fileIdToDelete) {
            return NextResponse.json({ message: 'File ID (fileId) is required in the body' }, { status: 400 });
        }

        const borrowRequest = await prisma.borrow.findUnique({
            where: { id: requestId, dataRequested: true },
            select: { dataFiles: true }
        });

        if (!borrowRequest) {
            return NextResponse.json({ message: 'Data request not found.' }, { status: 404 });
        }

        const existingFiles = (borrowRequest.dataFiles || []) as { id: string; name: string; url: string; size?: number; type?: string }[];
        const fileToDelete = existingFiles.find(file => file.id === fileIdToDelete);

        if (!fileToDelete) {
            console.warn(`File with ID '${fileIdToDelete}' not found in request ${requestId} for deletion.`);
            return NextResponse.json({ message: `File with ID '${fileIdToDelete}' not found.` }, { status: 404 });
        }

        // Construct the file path on disk
        // The file.name comes from the metadata, which was derived from the original upload.
        const filePathOnDisk = path.join(process.cwd(), 'public', 'uploads', 'data_requests', requestId, fileToDelete.name);

        try {
            await fs.unlink(filePathOnDisk);
            console.log(`File ${filePathOnDisk} deleted successfully from disk.`);
        } catch (fileError: unknown) {
            // Log the error but proceed to remove metadata if file not found (ENOENT)
            // If it's another error (e.g., permissions), it might be more serious.
            const errorWithCode = fileError as { code?: string };
            if (errorWithCode.code === 'ENOENT') {
                console.warn(`File ${filePathOnDisk} was already deleted or not found on disk.`);
            } else {
                console.error(`API Error - Failed to delete file ${filePathOnDisk} from disk:`, fileError);
                // Depending on policy, you might want to stop here or still remove metadata
                // For now, we'll return an error and not modify the database to ensure consistency concerns are highlighted.
                return NextResponse.json({ message: 'Error deleting file from disk. Metadata not updated.' }, { status: 500 });
            }
        }

        const updatedFiles = existingFiles.filter(file => file.id !== fileIdToDelete);

        const updatedRequest = await prisma.borrow.update({
            where: {
                id: requestId,
            },
            data: {
                dataFiles: updatedFiles,
            },
        });

        return NextResponse.json({ message: 'File deleted successfully', updatedRequest });
    } catch (error) {
        console.error(`API Error - DELETE /api/borrows/data-requests/${requestId}/delete-file:`, error);
        return NextResponse.json({ message: 'Internal Server Error during file deletion' }, { status: 500 });
    }
} 