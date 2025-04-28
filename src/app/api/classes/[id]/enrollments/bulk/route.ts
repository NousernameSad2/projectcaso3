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
export async function POST(req: NextRequest, { params }: RouteContext) {
  const classId = params.id;
  
  // 1. Verify Authentication and Authorization
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  // Fetch class details to check FIC
  let classData = null;
  try {
      classData = await prisma.class.findUnique({
          where: { id: classId },
          select: { ficId: true } // Only need ficId for auth check
      });
  } catch (dbError) {
      console.error("Error fetching class data for auth check:", dbError);
      // Handle potential DB errors during the check
  }
  
  if (!classData) {
       return NextResponse.json({ message: 'Class not found' }, { status: 404 });
  }

  const isStaff = payload.role === UserRole.STAFF;
  const isFIC = payload.role === UserRole.FACULTY && classData.ficId === payload.userId;
  const canEnroll = isStaff || isFIC;

  if (!canEnroll) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or the Class FIC can enroll students.' }, { status: 403 });
  }

  // 2. Parse and Validate Body
  let body;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedData = BulkEnrollmentSchema.safeParse(body);
  if (!parsedData.success) {
    return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
  }
  const { userIds } = parsedData.data;

  // 3. Create Enrollments (handle potential errors and duplicates for MongoDB)
  try {
    // Fetch IDs of users already enrolled in this class
    const existingEnrollments = await prisma.userClassEnrollment.findMany({
      where: {
        classId: classId,
        userId: { in: userIds } // Only check against the submitted user IDs
      },
      select: { userId: true }
    });
    const existingUserIds = new Set(existingEnrollments.map(e => e.userId));

    // Filter out users who are already enrolled
    const newUserIdsToEnroll = userIds.filter(id => !existingUserIds.has(id));

    if (newUserIdsToEnroll.length === 0) {
        console.log(`Bulk enrollment for class ${classId}: No new students to add.`);
        return NextResponse.json(
            { 
                message: "No new students to enroll (selected users might already be enrolled).", 
                count: 0 
            }, 
            { status: 200 } // OK status, nothing created
        );
    }

    // Prepare data for only the new users
    const enrollmentData = newUserIdsToEnroll.map(userId => ({
      userId: userId,
      classId: classId,
    }));

    // Use createMany (without skipDuplicates)
    const result = await prisma.userClassEnrollment.createMany({
      data: enrollmentData,
      // skipDuplicates: true, // Not supported on MongoDB
    });

    console.log(`Bulk enrollment for class ${classId}: ${result.count} new students added by ${payload.email}. Requested: ${userIds.length}, Already Enrolled: ${existingUserIds.size}`);
    
    // 4. Return Success Response
    return NextResponse.json(
        { 
            message: `${result.count} new student(s) enrolled successfully.`, 
            count: result.count 
        }, 
        { status: 201 } // 201 Created
    );

  } catch (error: any) {
    console.error(`API Error - POST /api/classes/${classId}/enrollments/bulk:`, error);
    if (error.code === 'P2003') { // Foreign key constraint failed (e.g., userId doesn't exist)
         return NextResponse.json({ message: 'One or more provided user IDs are invalid.' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Internal Server Error enrolling students' }, { status: 500 });
  }
} 