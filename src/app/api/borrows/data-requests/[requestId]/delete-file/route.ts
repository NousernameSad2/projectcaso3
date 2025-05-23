import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";

export async function DELETE(req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
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
        const fileIdToDelete = body.fileId as string; // Expecting fileId (or name if IDs are not consistently used yet)

        if (!fileIdToDelete) {
            return NextResponse.json({ message: 'File identifier (fileId) is required in the body' }, { status: 400 });
        }

        const borrowRequest = await prisma.borrow.findUnique({
            where: { id: requestId, dataRequested: true },
            select: { dataFiles: true }
        });

        if (!borrowRequest) {
            return NextResponse.json({ message: 'Data request not found.' }, { status: 404 });
        }

        const existingFiles = (borrowRequest.dataFiles || []) as { id: string; name: string; url: string }[];
        const updatedFiles = existingFiles.filter(file => file.id !== fileIdToDelete && file.name !== fileIdToDelete);

        if (updatedFiles.length === existingFiles.length) {
            // No file was actually removed, maybe ID didn't match
             console.warn(`File with identifier '${fileIdToDelete}' not found in request ${requestId} for deletion.`);
            // Depending on desired behavior, could return 404 or just success with no change
        }

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