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

// Schema for validating the incoming array of user IDs
const BulkEnrollmentSchema = z.object({
  userIds: z.array(z.string().min(1, { message: "User ID cannot be empty" })).min(1, { message: "At least one user ID must be provided." }),
});

// POST: Bulk enroll students into a class
export async function POST(req: NextRequest, { params: { id: classId } }: RouteContext) {
  // const classId = params.id; // No longer needed
  
  // 1. Verify Authentication and Authorization
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can enroll students.' }, { status: 403 });
  }

  if (!classId) {
      return NextResponse.json({ message: 'Class ID missing from URL path' }, { status: 400 });
  }

  // 2. Validate Request Body
  let validatedData;
  try {
    const body = await req.json();
    validatedData = BulkEnrollmentSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid input', errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { userIds } = validatedData;

  try {
    // 3. Check if class exists
    const targetClass = await prisma.class.findUnique({
      where: { id: classId }, // Use destructured classId
      select: { id: true }, // Only need to check existence
    });

    if (!targetClass) {
      return NextResponse.json({ message: `Class with ID ${classId} not found.` }, { status: 404 });
    }

    // 4. Check if all provided student IDs exist and are REGULAR users
    const existingStudents = await prisma.user.findMany({
        where: {
            id: { in: userIds },
            role: UserRole.REGULAR, // Ensure they are students
        },
        select: { id: true }
    });
    const existingStudentIds = new Set(existingStudents.map(s => s.id));
    const invalidStudentIds = userIds.filter(id => !existingStudentIds.has(id));

    if (invalidStudentIds.length > 0) {
        return NextResponse.json({
            message: `Invalid student IDs provided: ${invalidStudentIds.join(", ")}. Ensure IDs exist and belong to REGULAR users.`,
            invalidIds: invalidStudentIds,
        }, { status: 400 });
    }
    
    // 5. Find which students are *already* enrolled
    const currentEnrollments = await prisma.userClassEnrollment.findMany({
        where: {
            classId: classId, // Use destructured classId
            userId: { in: userIds }
        },
        select: { userId: true }
    });
    const alreadyEnrolledIds = new Set(currentEnrollments.map(e => e.userId));

    // 6. Determine which students need to be enrolled
    const studentIdsToEnroll = userIds.filter(id => !alreadyEnrolledIds.has(id));

    if (studentIdsToEnroll.length === 0) {
        return NextResponse.json({
            message: `All provided students (${userIds.length}) are already enrolled in this class.`,
            alreadyEnrolledCount: alreadyEnrolledIds.size
        }, { status: 200 }); // Use 200 OK with message
    }

    // 7. Prepare data for bulk creation
    const enrollmentData = studentIdsToEnroll.map(studentId => ({
      userId: studentId,
      classId: classId, // Use destructured classId
    }));

    // 8. Perform bulk creation
    const createResult = await prisma.userClassEnrollment.createMany({
      data: enrollmentData,
      // skipDuplicates: true, // Removed: Not supported on MongoDB
    });

    console.log(`Bulk enrollment for class ${classId}: ${createResult.count} new students added by ${payload.email}. Requested: ${userIds.length}, Already Enrolled: ${alreadyEnrolledIds.size}`);

    // 9. Return success response
    return NextResponse.json({
      message: `Successfully enrolled ${createResult.count} new students.`, 
      enrolledCount: createResult.count,
      alreadyEnrolledCount: alreadyEnrolledIds.size,
      requestedCount: userIds.length,
    }, { status: 201 }); // 201 Created

  } catch (error: any) {
    console.error(`API Error - POST /api/classes/${classId}/enrollments/bulk:`, error);
    // Handle specific Prisma errors if necessary (e.g., foreign key constraints)
    return NextResponse.json({ message: 'Internal Server Error during bulk enrollment' }, { status: 500 });
  }
} 