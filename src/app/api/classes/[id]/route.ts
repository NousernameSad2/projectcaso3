import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuthAndGetPayload } from '@/lib/authUtils';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

interface RouteContext {
  params: {
    id: string; // Class ID from the URL
  }
}

// GET: Get a specific class by ID, including enrolled students
export async function GET(req: NextRequest, { params: { id: classId } }: RouteContext) {
  // Allow any authenticated user to view class details
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload) { 
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
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

    // We can reshape the data slightly if needed, e.g., pull users directly
    // const enrolledStudents = classDetails.enrollments.map(e => e.user);
    // return NextResponse.json({ ...classDetails, enrolledStudents });

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
});

// PATCH: Update class details
export async function PATCH(req: NextRequest, { params: { id: classId } }: RouteContext) {
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
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = ClassUpdateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }
    
    const updateData = parsedData.data;

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
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: 'No update data provided' }, { status: 400 });
    }
    
    // If ficId is being updated, validate the new FIC
    if (updateData.ficId) {
        const facultyUser = await prisma.user.findUnique({
            where: { id: updateData.ficId },
            select: { id: true, role: true },
        });
        if (!facultyUser || facultyUser.role !== UserRole.FACULTY) {
            return NextResponse.json({ message: `Invalid new Faculty ID: User not found or is not Faculty.` }, { status: 400 });
        }
    }

    // Check for duplicate class ONLY if courseCode, section, or semester is changed
    if (updateData.courseCode || updateData.section || updateData.semester) {
        // Get current class details to check against
        const currentClass = await prisma.class.findUnique({ where: { id: classId } });
        if (!currentClass) {
             return NextResponse.json({ message: 'Class not found' }, { status: 404 }); // Should not happen if initial check passed
        }
        const checkCode = updateData.courseCode ?? currentClass.courseCode;
        const checkSection = updateData.section ?? currentClass.section;
        const checkSemester = updateData.semester ?? currentClass.semester;
        // academicYear is optional, handle null case gracefully
        const checkAcademicYear = updateData.academicYear ?? currentClass.academicYear ?? ''; // Use empty string if null
        
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
    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: updateData,
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

  } catch (error: any) {
    console.error(`API Error - PATCH /api/classes/${classId}:`, error);
    if (error.code === 'P2025') { // Record to update not found
        return NextResponse.json({ message: 'Class not found' }, { status: 404 });
    } 
    if (error.code === 'P2002') { // Unique constraint failed (should be caught above)
         return NextResponse.json({ message: 'Class already exists (unique constraint failed).' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error updating class' }, { status: 500 });
  }
}

// DELETE: Delete a class (sets classId to null in related records)
export async function DELETE(req: NextRequest, { params: { id: classId } }: RouteContext) {
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

  } catch (error: any) {
    console.error(`API Error - DELETE /api/classes/${classId}:`, error);
    
    // Specific check for Class Not Found
    if (error.code === 'P2025') { // Prisma error code for Record to delete does not exist
        console.log(`Attempted to delete non-existent class ${classId}`);
        return NextResponse.json({ message: 'Class not found' }, { status: 404 });
    }
    
    // Add general error handling for unexpected issues
    return NextResponse.json({ message: 'Internal Server Error deleting class' }, { status: 500 });
  }
} 