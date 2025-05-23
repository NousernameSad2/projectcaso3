import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from "@/lib/authOptions";
import { z } from 'zod';

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
    const params = await context.params; // Await the params
    const { requestId } = params; // Destructure after awaiting

    if (!session?.user?.id || (session.user.role !== UserRole.STAFF && session.user.role !== UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden: Insufficient permissions.' }, { status: 403 });
    }

    if (!requestId) {
        return NextResponse.json({ message: 'Request ID is required' }, { status: 400 });
    }

    try {
        const updatedBorrow = await prisma.borrow.update({
            where: {
                id: requestId,
                dataRequested: true, // Ensure we are acting on an active data request
            },
            data: {
                dataRequested: false,
                dataRequestRemarks: null,
                dataRequestStatus: null, // Or a specific status like 'CANCELLED_BY_ADMIN'
                dataFiles: [], // Clear any uploaded files
            },
        });

        if (!updatedBorrow) {
            return NextResponse.json({ message: 'Data request not found or already processed/cancelled.' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Data request cancelled successfully.' }, { status: 200 });
    } catch (error) {
        console.error(`API Error - DELETE /api/borrows/data-requests/${requestId}:`, error);
        if (error instanceof Error && error.message.includes("Record to update not found")) {
             return NextResponse.json({ message: 'Data request not found.' }, { status: 404 });
        }
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 