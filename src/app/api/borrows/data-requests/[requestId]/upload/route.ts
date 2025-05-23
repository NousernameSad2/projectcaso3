import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import { createId } from '@paralleldrive/cuid2';
import fs from 'fs/promises'; // For file system operations
import fsSync from 'fs'; // For stream operations
import path from 'path'; // For path manipulation
import { pipeline } from 'stream/promises'; // For stream pipeline

export async function POST(req: NextRequest, context: { params: Promise<{ requestId: string }> }) {
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
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ message: 'File is required' }, { status: 400 });
        }

        // Define the base directory for uploads using the configured volume path in the container
        // The volume is mounted at /app/uploads
        const baseUploadDir = path.join(process.cwd(), 'public', 'uploads', 'data_requests'); // Corrected base path
        const requestUploadDir = path.join(baseUploadDir, requestId);
        // Sanitize file.name to prevent path traversal issues if necessary, though modern browsers usually handle this.
        // For simplicity, we'll use file.name directly, assuming it's safe.
        const uniqueFilename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`; // Ensure filename is URL/filesystem safe
        const filePath = path.join(requestUploadDir, uniqueFilename);

        console.log(`[Upload] Attempting to create directory: ${requestUploadDir}`);
        // Ensure the directory exists
        try {
            await fs.mkdir(requestUploadDir, { recursive: true });
            console.log(`[Upload] Directory ensured: ${requestUploadDir}`);
        } catch (dirError) {
            console.error(`[Upload API Error] Failed to create directory ${requestUploadDir}:`, dirError);
            return NextResponse.json({ message: 'Failed to create upload directory.' }, { status: 500 });
        }

        console.log(`[Upload] Attempting to write file to: ${filePath}`);
        // Stream file to disk
        try {
            if (!file.stream) {
                // Fallback for environments where file.stream() might not be available (though standard in Node/Next.js)
                console.warn("File.stream() not available, falling back to arrayBuffer. This might be inefficient for large files.");
                const bytes = await file.arrayBuffer();
                const buffer = Buffer.from(bytes);
                await fs.writeFile(filePath, buffer);
            } else {
                // @ts-expect-error ReadableStream is not assignable to NodeJS.ReadableStream
                await pipeline(file.stream(), fsSync.createWriteStream(filePath));
            }
            console.log(`[Upload] File streamed successfully to: ${filePath}`);
        } catch (writeError) {
            console.error(`[Upload API Error] Failed to write file ${filePath}:`, writeError);
            // Attempt to delete partial file on error
            try {
                await fs.unlink(filePath);
                console.log(`Partially written file ${filePath} deleted.`);
            } catch (cleanupError) {
                console.error(`API Error - Failed to delete partially written file ${filePath}:`, cleanupError);
            }
            return NextResponse.json({ message: 'Failed to save uploaded file.' }, { status: 500 });
        }

        const fileId = createId(); 
        // The URL should be the public path, relative to the domain, matching the new storage structure
        const publicFileUrl = `/uploads/data_requests/${requestId}/${uniqueFilename}`; // Use uniqueFilename
        console.log(`[Upload] Generated public file URL: ${publicFileUrl} for file ID: ${fileId}`);

        const fileMetadata = { 
            id: fileId, 
            name: file.name, // Original file name for metadata
            url: publicFileUrl, // Use the public URL for client access
            size: file.size, 
            type: file.type 
        };

        const updatedRequest = await prisma.borrow.update({
            where: {
                id: requestId,
                dataRequested: true,
            },
            data: {
                dataFiles: {
                    push: fileMetadata, // Add the new file to the array
                },
            },
        });

        if (!updatedRequest) {
            return NextResponse.json({ message: 'Data request not found.' }, { status: 404 });
        }

        return NextResponse.json({ message: 'File uploaded successfully', file: fileMetadata, updatedRequest });
    } catch (error) {
        console.error(`API Error - POST /api/borrows/data-requests/${requestId}/upload:`, error);
        return NextResponse.json({ message: 'Internal Server Error during file upload' }, { status: 500 });
    }
} 