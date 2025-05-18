import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyAuthAndGetPayload } from '@/lib/authUtils';
import { UserRole } from '@prisma/client';

// Schema for validating the incoming array of user IDs
const BulkEnrollmentSchema = z.object({
  userIds: z.array(z.string().min(1, { message: "User ID cannot be empty" })).min(1, { message: "At least one user ID must be provided." }),
});

// POST: Bulk enroll students into a class
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params; // Await params
  const classId = params.id; // Extract classId
  
  // 1. Verify Authentication and Authorization
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can enroll students.' }, { status: 403 });
  }
  const { userId: actorUserId, role: actorRole } = payload;

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
    // *** NEW: Authorization Check for FACULTY ***
    let targetClassFicId: string | null = null; // Store FIC ID for logging/checking
    if (actorRole === UserRole.FACULTY) {
      const currentClass = await prisma.class.findUnique({ 
        where: { id: classId }, 
        select: { ficId: true }
      });
      if (!currentClass) {
         // Handled below, but good check
         return NextResponse.json({ message: `Class with ID ${classId} not found.` }, { status: 404 });
      }
      if (currentClass.ficId !== actorUserId) {
         console.warn(`Faculty ${actorUserId} attempted to bulk enroll in class ${classId} not assigned to them (FIC: ${currentClass.ficId})`);
         return NextResponse.json({ message: 'Forbidden: You can only enroll students in classes you are assigned to.' }, { status: 403 });
      }
      targetClassFicId = currentClass.ficId; // Store for later use
    }
    // *** END NEW: Authorization Check ***

    // 3. Check if class exists (already done in Auth check for faculty, but keep for staff)
    if (!targetClassFicId) { // Only check again if we didn't fetch it during auth
        const targetClass = await prisma.class.findUnique({
          where: { id: classId },
          select: { id: true, ficId: true }, // Select ficId here too if needed later
        });
        if (!targetClass) {
          return NextResponse.json({ message: `Class with ID ${classId} not found.` }, { status: 404 });
        }
        // Optional: Store targetClass.ficId if needed
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

  } catch (error: unknown) {
    console.error(`API Error - POST /api/classes/${classId}/enrollments/bulk:`, error);
    // Handle specific Prisma errors if necessary (e.g., foreign key constraints)
    return NextResponse.json({ message: 'Internal Server Error during bulk enrollment' }, { status: 500 });
  }
} 