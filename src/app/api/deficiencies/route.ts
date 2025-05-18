import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { UserRole, DeficiencyType, DeficiencyStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

// Define a type for the session user
interface SessionUser {
  id: string;
  role: UserRole;
}

// Validation schema for creating a deficiency
const CreateDeficiencySchema = z.object({
  borrowId: z.string().min(1, "Borrow ID is required"),
  userId: z.string().optional(), // Add userId as an optional field
  type: z.nativeEnum(DeficiencyType),
  description: z.string().optional(),
  ficToNotifyId: z.string().optional(), // Optional FIC to notify
});

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);

    // 1. Authentication: Ensure user is logged in
    const user = session?.user as SessionUser | undefined;
    if (!user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    
    // Role check removed - Any authenticated user can log deficiency
    // if (user.role !== UserRole.STAFF) { 
    //     return NextResponse.json({ message: 'Forbidden: Insufficient permissions to log deficiency.' }, { status: 403 });
    // }
    
    // The ID of the user *logging* the deficiency
    const loggedInUserId = user.id; 

    // 2. Parse and Validate Request Body
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = CreateDeficiencySchema.safeParse(body);
    if (!parsedData.success) {
        console.error("Deficiency Validation Errors:", parsedData.error.flatten());
        return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    const { borrowId, type, description, ficToNotifyId, userId } = parsedData.data;

    // --- Add Validation for borrowId format ---
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;
    if (!objectIdRegex.test(borrowId)) {
        return NextResponse.json({ message: 'Invalid Borrow ID format. Please provide a valid 24-character ID.' }, { status: 400 });
    }
    // --- End Validation ---

    try {
        // 3. Get required info from the related Borrow record
        const borrowInfo = await prisma.borrow.findUnique({
            where: { id: borrowId },
            select: { borrowerId: true, ficId: true } // Need borrowerId and optional ficId
        });

        if (!borrowInfo) {
            return NextResponse.json({ message: `Borrow record not found: ${borrowId}` }, { status: 404 });
        }

        // 4. Create the Deficiency Record
        const newDeficiency = await prisma.deficiency.create({
            data: {
                borrowId: borrowId,
                userId: userId || borrowInfo.borrowerId,    // Use provided userId or fallback to borrowerId
                taggedById: loggedInUserId,       // The user who submitted this POST request
                ficToNotifyId: ficToNotifyId || undefined,  // Use ficToNotifyId from form, or undefined if not provided
                type: type,
                status: DeficiencyStatus.UNRESOLVED,
                description: description || undefined,
            },
        });

        // 5. Return Success Response
        return NextResponse.json(newDeficiency, { status: 201 });

    } catch (error) {
        console.error("API Error - POST /api/deficiencies:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// GET: Fetch deficiencies (role-based filtering)
export async function GET(request: NextRequest) {
  // 1. Get User Session
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;

  // 2. Authentication Check
  if (!user?.id || !user?.role) { // Ensure role is available
    return NextResponse.json({ error: 'Unauthorized or invalid session' }, { status: 401 });
  }

  // 3. Fetch Deficiencies with Role-Based Filtering
  try {
    const { searchParams } = request.nextUrl; // Use nextUrl with NextRequest
    const statusFilter = searchParams.get('status') as DeficiencyStatus | null;

    const whereClause: Prisma.DeficiencyWhereInput = {};
    
    // Add status filter if provided and valid
    if (statusFilter && Object.values(DeficiencyStatus).includes(statusFilter)) {
      whereClause.status = statusFilter;
    }

    // *** Add Role-Based Filter ***
    if (user.role === UserRole.REGULAR) {
      // If user is REGULAR, only show deficiencies assigned to them
      whereClause.userId = user.id;
    } 
    // STAFF and FACULTY will not have the userId filter added, thus seeing all deficiencies
    // matching the status filter (if any).
    
    console.log(`[API Deficiencies GET] Fetching for Role: ${user.role}, Filter:`, whereClause);

    const deficiencies = await prisma.deficiency.findMany({
       where: whereClause,
       include: {
         user: { // User responsible
           select: { id: true, name: true, email: true }
         },
         taggedBy: { // Admin/Staff who tagged
           select: { id: true, name: true }
         },
         borrow: { // Related borrow info
           select: { 
              id: true, 
              equipment: { select: { id: true, name: true, equipmentId: true }} 
           }
         },
         ficToNotify: { select: { id: true, name: true } } // Include FIC to notify
       },
       orderBy: {
         createdAt: 'desc', // Show newest first
       }
    });

    // 4. Return Deficiencies
    return NextResponse.json(deficiencies);

  } catch (_error) {
    console.error("Failed to fetch deficiencies:", _error);
    return NextResponse.json({ error: 'Database error occurred while fetching deficiencies.' }, { status: 500 });
  }
}

// TODO: Add PUT/PATCH handler later for editing deficiencies 