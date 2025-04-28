import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyAuthAndGetPayload } from '@/lib/authUtils';
import { UserRole } from '@prisma/client';

interface RouteContext {
  params: {
    id: string; // Class ID from the URL
  }
}

// Schema for validating enrollment input
const EnrollmentCreateSchema = z.object({
  userId: z.string({ required_error: "User ID is required." }),
});

// POST: Enroll a user (student) into a specific class
export async function POST(req: NextRequest, { params }: RouteContext) {
  const classId = params.id;
  // Verify user is STAFF or FACULTY (only they can enroll students)
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can manage enrollments.' }, { status: 403 });
  }

  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing' }, { status: 400 });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = EnrollmentCreateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    const { userId } = parsedData.data;

    // --- Data Validation --- 
    // 1. Check if class exists
    const classExists = await prisma.class.findUnique({ where: { id: classId } });
    if (!classExists) {
      return NextResponse.json({ message: 'Class not found' }, { status: 404 });
    }

    // 2. Check if user exists and is REGULAR (or maybe allow faculty/staff enrollment too? Decide later)
    const userExists = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { id: true, role: true } // Select only needed fields
    });
    if (!userExists) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }
    // Optional: Restrict enrollment to REGULAR users? 
    // if (userExists.role !== UserRole.REGULAR) {
    //     return NextResponse.json({ message: 'Only Regular users can be enrolled as students.' }, { status: 400 });
    // }

    // 3. Check if enrollment already exists
    const existingEnrollment = await prisma.userClassEnrollment.findUnique({
        where: { userId_classId: { userId, classId } }
    });
    if (existingEnrollment) {
        return NextResponse.json({ message: 'User is already enrolled in this class.' }, { status: 409 }); // Conflict
    }

    // --- Create Enrollment --- 
    const newEnrollment = await prisma.userClassEnrollment.create({
      data: {
        userId: userId,
        classId: classId,
      },
      include: { // Include user details in the response
        user: { 
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
            }
        }
      }
    });

    console.log(`User ${userId} enrolled in class ${classId} by ${payload.email}`);
    // Return the newly created enrollment record, including nested user data
    return NextResponse.json({ message: "User enrolled successfully", enrollment: newEnrollment }, { status: 201 });

  } catch (error: any) {
    console.error(`API Error - POST /api/classes/${classId}/enrollments:`, error);
     if (error.code === 'P2002') { // Should be caught above, but safeguard
         return NextResponse.json({ message: 'Enrollment already exists.' }, { status: 409 });
    }
     // Handle other potential errors (e.g., foreign key constraint if class/user deleted mid-request)
    return NextResponse.json({ message: 'Internal Server Error enrolling user' }, { status: 500 });
  }
}

// DELETE: Unenroll a user (student) from a specific class
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const classId = params.id;
  // Verify user is STAFF or FACULTY
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can manage enrollments.' }, { status: 403 });
  }

  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing' }, { status: 400 });
  }

  // Get userId from query parameters
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ message: 'User ID is missing from query parameters.' }, { status: 400 });
  }

  try {
    // --- Delete Enrollment --- 
    // We use deleteMany because the unique constraint is on the combination,
    // and Prisma doesn't automatically generate a delete based on the composite key.
    // It also gracefully handles cases where the enrollment might not exist.
    const deleteResult = await prisma.userClassEnrollment.deleteMany({
      where: {
        classId: classId,
        userId: userId,
      },
    });

    if (deleteResult.count === 0) {
        // Although not strictly an error if the goal is removal, 
        // inform client the target didn't exist.
        return NextResponse.json({ message: 'Enrollment record not found.' }, { status: 404 });
    }

    console.log(`User ${userId} unenrolled from class ${classId} by ${payload.email}`);
    // Return success with No Content status
    return new NextResponse(null, { status: 204 }); 

  } catch (error: any) {
    console.error(`API Error - DELETE /api/classes/${classId}/enrollments?userId=${userId}:`, error);
    // Handle potential errors
    return NextResponse.json({ message: 'Internal Server Error unenrolling user' }, { status: 500 });
  }
} 