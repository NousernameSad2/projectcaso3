import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuthAndGetPayload } from '@/lib/authUtils';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';

// GET: Get a specific class by ID, including enrolled students
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const classId = params.id;
  // Allow any authenticated user to view class details
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload) { 
    return NextResponse.json({ message: 'Authentication required or Forbidden' }, { status: 401 });
  }
  
  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing' }, { status: 400 });
  }

  try {
    const classDetails = await prisma.class.findUnique({
      where: { id: classId },
      select: { // Be explicit about all required fields
        id: true,
        courseCode: true,
        section: true,
        semester: true,
        academicYear: true,
        schedule: true,
        venue: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        fic: { 
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        enrollments: { // Include the join table records
          orderBy: { 
            user: { name: 'asc' } // Order enrollments by user name
          },
          include: {
            user: { // Include user details for each enrollment
              select: {
                id: true,
                name: true,
                email: true,
                role: true, // Include role if needed
                status: true, // Include status if needed
              },
            },
          },
        },
      },
    });

    if (!classDetails) {
      return NextResponse.json({ message: 'Class not found' }, { status: 404 });
    }

    console.log("Fetched classDetails:", JSON.stringify(classDetails, null, 2));

    return NextResponse.json(classDetails);

  } catch (error) {
    console.error(`API Error - GET /api/classes/${classId}:`, error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// Schema for validating class updates (all fields optional)
const ClassUpdateSchema = z.object({
  courseCode: z.string().min(3, { message: "Course code must be at least 3 characters." }).optional(),
  section: z.string().min(1, { message: "Section is required." }).optional(),
  semester: z.string().min(5, { message: "Semester format incorrect (e.g., 'AY23-24 1st')." }).optional(),
  ficId: z.string().optional(),
  isActive: z.boolean().optional(),
  academicYear: z.string().optional(),
  schedule: z.string().optional(),
  venue: z.string().optional(),
});

// PATCH: Update class details
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const classId = params.id;
  // Verify user is STAFF or FACULTY
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can update classes.' }, { status: 403 });
  }
  const { userId, role } = payload;

  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const validatedData = ClassUpdateSchema.parse(body);

    // *** NEW: Authorization Check for FACULTY ***
    if (role === UserRole.FACULTY) {
      const currentClass = await prisma.class.findUnique({
        where: { id: classId },
        select: { ficId: true },
      });
      if (!currentClass) {
        return NextResponse.json({ message: 'Class not found' }, { status: 404 });
      }
      if (currentClass.ficId !== userId) {
        console.warn(`Faculty ${userId} attempted to update class ${classId} not assigned to them (FIC: ${currentClass.ficId})`);
        return NextResponse.json({ message: 'Forbidden: You can only update classes you are assigned to.' }, { status: 403 });
      }
    }
    // *** END NEW: Authorization Check ***

    // Ensure at least one field is being updated
    if (Object.keys(validatedData).length === 0) {
      return NextResponse.json({ message: 'No update data provided' }, { status: 400 });
    }
    
    // If ficId is being updated, validate the new FIC
    if (validatedData.ficId) {
        const facultyUser = await prisma.user.findUnique({
            where: { id: validatedData.ficId },
            select: { id: true, role: true },
        });
        if (!facultyUser || facultyUser.role !== UserRole.FACULTY) {
            return NextResponse.json({ message: `Invalid new Faculty ID: User not found or is not Faculty.` }, { status: 400 });
        }
    }

    // Check for duplicate class ONLY if courseCode, section, or semester is changed
    if (validatedData.courseCode || validatedData.section || validatedData.semester) {
        // Get current class details to check against
        const currentClass = await prisma.class.findUnique({ where: { id: classId } });
        if (!currentClass) {
             return NextResponse.json({ message: 'Class not found' }, { status: 404 }); // Should not happen if initial check passed
        }
        const checkCode = validatedData.courseCode ?? currentClass.courseCode;
        const checkSection = validatedData.section ?? currentClass.section;
        const checkSemester = validatedData.semester ?? currentClass.semester;
        // academicYear is optional, handle null case gracefully
        const checkAcademicYear = validatedData.academicYear ?? currentClass.academicYear ?? ''; // Use empty string if null
        
        // Check against the correct composite unique constraint including academicYear
        const existingClass = await prisma.class.findUnique({
            where: {
                courseCode_section_semester_academicYear: { // Use the default prisma index name
                    courseCode: checkCode, 
                    section: checkSection, 
                    semester: checkSemester, 
                    academicYear: checkAcademicYear 
                },
                NOT: { id: classId } // Exclude the current class itself
            }
        });
        if (existingClass) {
             return NextResponse.json({ message: `Another class (${checkCode} ${checkSection} ${checkSemester} ${checkAcademicYear}) already exists.` }, { status: 409 });
        }
    }

    // --- Update Class --- 
    // Prepare data, removing schedule if it's not in the model - NO LONGER NEEDED
    // const { schedule, ...updateData } = validatedData; // Exclude schedule for now - REMOVED

    const updatedClass = await prisma.class.update({
      where: { id: classId },
      // data: updateData, // Use validatedData directly now - REMOVED
      data: validatedData,
      include: { // Include details needed for UI update
        fic: { 
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { enrollments: true },
        },
      },
    });

    console.log(`Class ${classId} updated by ${payload.email}`);
    return NextResponse.json({ message: "Class updated successfully", class: updatedClass });

  } catch (error: unknown) {
    console.error(`API Error - PATCH /api/classes/${classId}:`, error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return NextResponse.json({ message: 'Class not found' }, { status: 404 });
    } 
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
         return NextResponse.json({ message: 'Class already exists (unique constraint failed).' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error updating class' }, { status: 500 });
  }
}

// DELETE: Delete a class (sets classId to null in related records)
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const classId = params.id;
  // Verify user is STAFF or FACULTY 
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can delete classes.' }, { status: 403 });
  }
  const { userId, role } = payload;

  if (!classId) {
    return NextResponse.json({ message: 'Class ID is missing' }, { status: 400 });
  }

  try {
    // *** NEW: Authorization Check for FACULTY ***
    if (role === UserRole.FACULTY) {
      const currentClass = await prisma.class.findUnique({
        where: { id: classId },
        select: { ficId: true },
      });
      // If class doesn't exist, P2025 will be caught later anyway, but good practice to check
      if (currentClass && currentClass.ficId !== userId) { 
        console.warn(`Faculty ${userId} attempted to DELETE class ${classId} not assigned to them (FIC: ${currentClass.ficId})`);
        return NextResponse.json({ message: 'Forbidden: You can only delete classes you are assigned to.' }, { status: 403 });
      }
      // Allow deletion if class doesn't exist (will throw P2025 below) or if FIC matches
    }
    // *** END NEW: Authorization Check ***

    // Attempt to delete the class directly.
    // onDelete: SetNull in schema should handle related Borrows and Enrollments.
    console.log(`Attempting deletion for class ${classId}. Related records will have classId set to null.`);
    
    await prisma.class.delete({ 
        where: { id: classId } 
    });

    console.log(`Class ${classId} deleted by ${payload.email}. Related Borrow/Enrollment classIds set to null.`);
    // Return success with No Content status
    return new NextResponse(null, { status: 204 }); 

  } catch (error: unknown) {
    console.error(`API Error - DELETE /api/classes/${classId}:`, error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        // Record to delete not found
        return NextResponse.json({ message: 'Class not found or already deleted' }, { status: 404 });
    }
    
    // Add general error handling for unexpected issues
    return NextResponse.json({ message: 'Internal Server Error deleting class' }, { status: 500 });
  }
} 