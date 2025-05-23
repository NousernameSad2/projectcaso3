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

// Schema for validating class updates (all fields optional, but with min length if provided)
const ClassUpdateSchema = z.object({
  courseCode: z.string().min(3, { message: "Course code must be at least 3 characters." }).optional(),
  section: z.string().min(1, { message: "Section is required." }).optional(),
  semester: z.string().min(5, { message: "Semester format incorrect (e.g., 'AY23-24 1st')." }).optional(),
  ficId: z.string().optional(), // Remains optional in schema; logic below enforces for Staff if provided
  isActive: z.boolean().optional(),
  academicYear: z.string().optional(),
  schedule: z.string().min(1, { message: "Class schedule cannot be empty if provided." }).optional(),
  venue: z.string().optional(),
});

// PATCH: Update class details
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const classId = params.id;
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
    
    const updatePayload: Prisma.ClassUpdateInput = {};

    // Role-specific validation and payload construction
    if (role === UserRole.STAFF) {
      // If schedule is explicitly provided by staff and is empty, it's an error.
      if (body.hasOwnProperty('schedule') && !validatedData.schedule) {
        return NextResponse.json({ message: 'Class schedule cannot be empty when provided.', errors: { schedule: ['Schedule is required if you intend to set/change it.'] } }, { status: 400 });
      }
      
      const { ficId, ...restOfValidatedData } = validatedData;
      Object.assign(updatePayload, restOfValidatedData);

      if (ficId) { // If ficId is provided by staff, try to connect to it
        const facultyUser = await prisma.user.findUnique({
            where: { id: ficId },
            select: { id: true, role: true },
        });
        if (!facultyUser || facultyUser.role !== UserRole.FACULTY) {
            return NextResponse.json({ message: `Invalid new Faculty ID: User not found or is not Faculty.` }, { status: 400 });
        }
        updatePayload.fic = { connect: { id: ficId } };
      } // If ficId is not in validatedData (undefined), FIC relation is not changed by staff.

    } else if (role === UserRole.FACULTY) {
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

      // facultyAllowedUpdates will get all validatedData. isActive changes will be ignored as updatePayload.isActive is not set.
      // updatePayload.fic will be explicitly set to connect to userId, overriding any ficId from validatedData.
      const { ...facultyAllowedUpdates } = validatedData;
      Object.assign(updatePayload, facultyAllowedUpdates);
      // FIC for faculty is always their own ID, ensures it's connected.
      updatePayload.fic = { connect: { id: userId } }; 

      if (body.hasOwnProperty('schedule') && !validatedData.schedule) {
        return NextResponse.json({ message: 'Class schedule cannot be empty when provided.', errors: { schedule: ['Schedule is required if you intend to set/change it.'] } }, { status: 400 });
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ message: 'No valid update data provided or no changes made' }, { status: 400 });
    }

    // Duplicate check logic
    if (validatedData.courseCode || validatedData.section || validatedData.semester || validatedData.academicYear) {
        const currentClassDetails = await prisma.class.findUnique({ where: { id: classId } });
        if (!currentClassDetails) return NextResponse.json({ message: 'Class not found' }, { status: 404 });

        const checkCode = validatedData.courseCode ?? currentClassDetails.courseCode;
        const checkSection = validatedData.section ?? currentClassDetails.section;
        const checkSemester = validatedData.semester ?? currentClassDetails.semester;
        const checkAcademicYear = validatedData.academicYear ?? currentClassDetails.academicYear ?? '';
        
        const existingClass = await prisma.class.findUnique({
            where: {
                courseCode_section_semester_academicYear: {
                    courseCode: checkCode,
                    section: checkSection,
                    semester: checkSemester,
                    academicYear: checkAcademicYear
                },
                NOT: { id: classId }
            }
        });
        if (existingClass) {
             return NextResponse.json({ message: `Another class (${checkCode} ${checkSection} ${checkSemester} ${checkAcademicYear}) already exists.` }, { status: 409 });
        }
    }

    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: updatePayload,
      include: { 
        fic: { select: { id: true, name: true, email: true } },
        _count: { select: { enrollments: true } },
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