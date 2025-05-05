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
  // Await params - experimental based on Next.js warning
  // It's unusual to await params directly, but let's follow the warning's suggestion
  // We might need to adjust typing if this causes issues
  const resolvedParams = await params;
  const classId = resolvedParams.id;
  
  // Verify user is STAFF or FACULTY
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can manage enrollments.' }, { status: 403 });
  }
  const { userId: actorUserId, role: actorRole } = payload;

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

    // --- Authorization Check for FACULTY --- 
    if (actorRole === UserRole.FACULTY) {
      const currentClass = await prisma.class.findUnique({ 
        where: { id: classId }, 
        select: { ficId: true }
      });
      if (!currentClass) {
        // Handled below by classExists check, but good to double-check
         return NextResponse.json({ message: 'Class not found' }, { status: 404 });
      }
      if (currentClass.ficId !== actorUserId) {
         console.warn(`Faculty ${actorUserId} attempted to enroll user ${userId} in class ${classId} not assigned to them (FIC: ${currentClass.ficId})`);
         return NextResponse.json({ message: 'Forbidden: You can only enroll students in classes you are assigned to.' }, { status: 403 });
      }
    }
    // --- End Authorization Check ---

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
  // Await params - experimental based on Next.js warning
  const resolvedParams = await params;
  const classId = resolvedParams.id;

  // Verify user is STAFF or FACULTY
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can manage enrollments.' }, { status: 403 });
  }
  const { userId: actorUserId, role: actorRole } = payload; // Renamed for clarity

  const userId = req.nextUrl.searchParams.get('userId'); // User to unenroll

  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing in URL path' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ message: 'User ID (userId) is missing in query parameters' }, { status: 400 });
  }

  // Basic check if userId format seems plausible (optional, Prisma handles actual validation)
  if (typeof userId !== 'string' || userId.length < 5) { // CUIDs/ObjectIds are usually longer
       return NextResponse.json({ message: 'Invalid User ID format provided' }, { status: 400 });
  }

  try {
    // --- Authorization Check for FACULTY --- 
    if (actorRole === UserRole.FACULTY) {
      const currentClass = await prisma.class.findUnique({ 
        where: { id: classId }, 
        select: { ficId: true }
      });
       if (!currentClass) {
         // If class doesn't exist, the enrollment won't either (caught later)
         // Still, good to prevent unnecessary checks
         return NextResponse.json({ message: 'Class not found' }, { status: 404 });
       }
      if (currentClass.ficId !== actorUserId) {
         console.warn(`Faculty ${actorUserId} attempted to unenroll user ${userId} from class ${classId} not assigned to them (FIC: ${currentClass.ficId})`);
         return NextResponse.json({ message: 'Forbidden: You can only unenroll students from classes you are assigned to.' }, { status: 403 });
      }
    }
    // --- End Authorization Check ---

    // Check if the enrollment actually exists before deleting
    const existingEnrollment = await prisma.userClassEnrollment.findUnique({
        where: {
            userId_classId: { // Use the compound key defined in schema
                userId: userId,
                classId: classId, // Use destructured classId
            }
        }
    });

    if (!existingEnrollment) {
        return NextResponse.json({ message: 'Enrollment not found' }, { status: 404 });
    }

    // Proceed with deletion
    await prisma.userClassEnrollment.delete({
      where: {
        userId_classId: { // Use the compound key
          userId: userId,
          classId: classId, // Use destructured classId
        },
      },
    });

    console.log(`User ${userId} unenrolled from class ${classId} by ${payload.email}`);
    return new NextResponse(null, { status: 204 }); // Success, No Content

  } catch (error: any) {
    console.error(`API Error - DELETE /api/classes/${classId}/enrollments for user ${userId}:`, error);
    if (error.code === 'P2025') {
        // Error specific to record not found during delete operation
        return NextResponse.json({ message: 'Enrollment not found or already deleted' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 