import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
// Need to import verifyAuthAndGetPayload as GET needs auth check
import { verifyAuthAndGetPayload } from '@/lib/authUtils'; 
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';

// Schema for validating class creation input
const ClassCreateSchema = z.object({
  courseCode: z.string().min(3, { message: "Course code must be at least 3 characters." }),
  section: z.string().min(1, { message: "Section is required." }),
  semester: z.string().min(5, { message: "Semester format incorrect (e.g., 'AY23-24 1st')." }), // Basic check
  academicYear: z.string().regex(/^\d{4}-\d{4}$/, { message: "Academic Year must be in YYYY-YYYY format." }), // Added academic year
  ficId: z.string().optional(), // Stays optional here; logic below handles requirement for Staff
  schedule: z.string().min(1, { message: "Class schedule is required." }), // Made schedule required
  venue: z.string().optional(),    // <<< Add venue
});

// GET: List classes based on user role
export async function GET(req: NextRequest) {
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload) { 
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  
  const { userId, role } = payload;

  // *** NEW: Get isActive filter from query params ***
  const url = new URL(req.url);
  const isActiveParam = url.searchParams.get('isActive'); // 'true', 'false', or null
  let isActiveFilter: boolean | undefined = undefined;
  if (isActiveParam === 'true') {
    isActiveFilter = true;
  } else if (isActiveParam === 'false') {
    isActiveFilter = false;
  }
  // If null or any other value, isActiveFilter remains undefined (fetch all)
  // *** END NEW ***

  try {
    let classes;
    const commonInclude = { // Define common includes to avoid repetition
      fic: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      _count: {
            select: { 
                enrollments: true, 
                borrowRequests: true
            },
        },
    };
    // Revert to simpler orderBy syntax
    // Explicitly type the array elements to satisfy Prisma's expected input type
    const commonOrderBy: Prisma.ClassOrderByWithRelationInput[] = [
      { semester: Prisma.SortOrder.desc }, 
      { academicYear: Prisma.SortOrder.desc }, // Keep academicYear here
      { courseCode: Prisma.SortOrder.asc },
      { section: Prisma.SortOrder.asc },
    ];

    // --- Query Building --- 
    const whereClause: Prisma.ClassWhereInput = {};

    // Apply isActive filter if provided
    if (isActiveFilter !== undefined) {
      whereClause.isActive = isActiveFilter;
    }

    if (role === UserRole.REGULAR) {
      // Students: Fetch only classes they are enrolled in
      // Apply isActive filter to the nested class within enrollment
      console.log(`Fetching enrolled classes for REGULAR user ${userId} (isActive: ${isActiveParam ?? 'all'})`);
      const enrollments = await prisma.userClassEnrollment.findMany({
        where: { 
          userId: userId,
          // *** NEW: Filter based on class isActive status ***
          class: isActiveFilter !== undefined ? { isActive: isActiveFilter } : undefined,
        },
        select: {
          class: { 
            include: commonInclude,
          },
        },
      });
      classes = enrollments.map(enrollment => enrollment.class).filter(Boolean);
      
      // Manual sort for student view
      classes.sort((a, b) => {
          const sectionOrder = (a!.section || '').localeCompare(b!.section || '');
          if (sectionOrder !== 0) return sectionOrder;
          const semesterOrder = (b!.semester || '').localeCompare(a!.semester || '');
          if (semesterOrder !== 0) return semesterOrder;
          const yearOrder = (b!.academicYear || '').localeCompare(a!.academicYear || ''); 
          if (yearOrder !== 0) return yearOrder;
          return 0;
      });

    } else if (role === UserRole.FACULTY) { 
        // Faculty: Fetch ONLY their assigned classes
        whereClause.ficId = userId; // Add FIC filter
        console.log(`Fetching assigned classes for FACULTY user ${userId} (isActive: ${isActiveParam ?? 'all'})`);
        classes = await prisma.class.findMany({
            where: whereClause, // Apply combined where clause
            include: commonInclude,
            orderBy: commonOrderBy,
        });
    } else if (role === UserRole.STAFF) { 
        // Staff: Fetches ALL classes (respecting isActive filter)
        console.log(`Fetching ALL classes for STAFF user ${userId} (isActive: ${isActiveParam ?? 'all'})`);
        classes = await prisma.class.findMany({
            where: whereClause, // Apply isActive filter
            include: commonInclude,
            orderBy: commonOrderBy,
        });
    } else {
        // Should not happen based on verifyAuthAndGetPayload, but good practice
        console.warn(`User ${userId} has unexpected role ${role} trying to fetch classes.`);
        return NextResponse.json({ message: 'Forbidden: Invalid role.' }, { status: 403 });
    }

    return NextResponse.json(classes);

  } catch (error) {
    console.error("API Error - GET /api/classes:", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create a new class (Admin/Faculty only)
export async function POST(req: NextRequest) {
  const payload = await verifyAuthAndGetPayload(req);
  if (!payload || (payload.role !== UserRole.STAFF && payload.role !== UserRole.FACULTY)) {
    return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can create classes.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    // Use a temporary schema for initial parsing if ficId handling is complex
    // For now, let the main schema parse and we add logic below.
    const validatedData = ClassCreateSchema.parse(body);

    let finalFicId = validatedData.ficId;

    if (payload.role === UserRole.FACULTY) {
      // If faculty, always set their own ID as FIC, overriding any (unlikely) input
      finalFicId = payload.userId;
    } else if (payload.role === UserRole.STAFF) {
      // If staff, FIC is required from input
      if (!validatedData.ficId) {
        return NextResponse.json({ message: 'ficId is required for Staff creating a class.', errors: { ficId: ['Faculty ID (ficId) is required.'] } }, { status: 400 });
      }
      // finalFicId is already validatedData.ficId from above
    }
    
    // Ensure finalFicId is not undefined before creating if your DB schema requires it (even if Zod allows optional)
    if (!finalFicId) {
        // This case should ideally not be hit if logic above is correct for STAFF/FACULTY
        console.error("Error: finalFicId is undefined before class creation. Role:", payload.role, "Validated ficId:", validatedData.ficId);
        return NextResponse.json({ message: 'Internal error: FIC ID could not be determined.' }, { status: 500 });
    }

    const newClass = await prisma.class.create({
      data: {
        ...validatedData,
        ficId: finalFicId, // Use the determined finalFicId
      }
    });

    // Log class creation
    console.log(`Class created by ${payload.email} (Role: ${payload.role}): ID=${newClass.id}, Course=${newClass.courseCode}, FIC=${finalFicId}`);
    // Return the created class along with a success message
    return NextResponse.json({ message: "Class created successfully!", class: newClass }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid input', errors: error.errors }, { status: 400 });
    }
    console.error("API Error - POST /api/classes:", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 