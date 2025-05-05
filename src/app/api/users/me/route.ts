import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Adjust path if needed
import { prisma } from '@/lib/prisma';
import { ProfileUpdateSchema } from '@/lib/schemas'; // Import the update schema
import { z } from 'zod';

// GET handler to fetch current user's details
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        const user = await prisma.user.findUnique({
            where: {
                id: userId,
            },
            // Select only the fields safe to return to the client
            select: {
                id: true,
                name: true,
                email: true,
                studentNumber: true,
                contactNumber: true,
                sex: true,
                role: true,
                status: true,
                createdAt: true,
                // DO NOT SELECT PASSWORD HASH
            },
        });

        if (!user) {
            return NextResponse.json({ message: 'User not found' }, { status: 404 });
        }

        return NextResponse.json(user, { status: 200 });

    } catch (error) {
        console.error('Error fetching user details:', error);
        return NextResponse.json({ message: 'Error fetching user details' }, { status: 500 });
    }
}

// PATCH handler for updating user profile
export async function PATCH(req: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        let body;
        try {
            body = await req.json();
        } catch (error) {
            return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
        }

        // Validate the incoming data
        const parsedData = ProfileUpdateSchema.safeParse(body);

        if (!parsedData.success) {
            console.error("Profile Update Validation Errors:", parsedData.error.flatten());
            return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
        }

        const updateData = parsedData.data;

        // Ensure we don't try to update with undefined values if fields were omitted
        const dataToUpdate: { [key: string]: any } = {};
        if (updateData.name !== undefined) dataToUpdate.name = updateData.name;
        
        // Assign directly, Zod validation already ensures non-empty string
        if (updateData.studentNumber !== undefined) {
            dataToUpdate.studentNumber = updateData.studentNumber;
        }
        
        // Assign directly, Zod validation already ensures non-empty string
        if (updateData.contactNumber !== undefined) {
            dataToUpdate.contactNumber = updateData.contactNumber;
        }
        
        if (updateData.sex !== undefined) dataToUpdate.sex = updateData.sex;

        // Check if there is actually anything to update
        if (Object.keys(dataToUpdate).length === 0) {
             return NextResponse.json({ message: 'No valid fields provided for update.' }, { status: 400 });
        }

        // Perform the update
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: dataToUpdate,
             // Select the updated fields (excluding password) to return
            select: {
                id: true,
                name: true,
                email: true,
                studentNumber: true,
                contactNumber: true,
                sex: true,
                role: true,
                status: true,
                updatedAt: true, // Include updatedAt to show change
            },
        });

        return NextResponse.json(updatedUser, { status: 200 });

    } catch (error) {
        console.error('Error updating user profile:', error);
        // Add specific error handling if needed (e.g., Prisma errors)
        return NextResponse.json({ message: 'Error updating profile' }, { status: 500 });
    }
}

// We will add the PATCH handler for updates later 