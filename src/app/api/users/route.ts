import { NextRequest, NextResponse } from 'next/server';
// import { z } from 'zod'; // Removed unused z
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { AdminUserCreateSchema } from '@/lib/schemas';
import { UserRole, UserStatus } from '@prisma/client'; // Removed UserStatus
import { getServerSession } from "next-auth/next";
import { authOptions } from '@/lib/authOptions';
import { Prisma } from '@prisma/client';

const SALT_ROUNDS = 10; // Use the same salt rounds as registration

// GET: List users, optionally filtered by role, search query, and sorted
export async function GET(req: NextRequest) {
  // Get current user session using next-auth
  const session = await getServerSession(authOptions);
  if (!session?.user) { // Check for session and user object
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
  }
  const requestingUser = session.user;

  // Allow STAFF or FACULTY to request user lists
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!allowedRoles.includes(requestingUser.role as UserRole)) { // Cast role from session if needed
     return NextResponse.json({ message: 'Forbidden: Insufficient role' }, { status: 403 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const roleParams = searchParams.getAll('role'); 
    const rolesToFilter: UserRole[] = [];
    const searchQuery = searchParams.get('search')?.trim();
    const sortBy = searchParams.get('sortBy') || 'name';
    const sortOrderParam = searchParams.get('sortOrder') || 'asc';
    const sortOrder = sortOrderParam.toLowerCase() === 'desc' ? Prisma.SortOrder.desc : Prisma.SortOrder.asc;
    const statusQuery = searchParams.get('status')?.toUpperCase(); // New: Get status query

    const allowedSortByFields: (keyof Prisma.UserOrderByWithRelationInput)[] = ['name', 'email', 'role', 'status', 'createdAt', 'updatedAt'];
    const validSortBy = allowedSortByFields.includes(sortBy as keyof Prisma.UserOrderByWithRelationInput) ? sortBy : 'name';

    if (roleParams.length > 0) {
        roleParams.forEach(param => {
            param.split(',').forEach(roleStr => {
                 const role = roleStr.trim().toUpperCase();
                 if (Object.values(UserRole).includes(role as UserRole)) {
                    rolesToFilter.push(role as UserRole);
                 }
            });
        });
    }

    let whereClause: Prisma.UserWhereInput = {}; 
    if (rolesToFilter.length > 0) {
        whereClause = { role: { in: rolesToFilter } };
    } else {
        // If no role filter is provided, allow STAFF or FACULTY to get the full list
        const canGetAllUsers = requestingUser.role === UserRole.STAFF || requestingUser.role === UserRole.FACULTY;
        if (!canGetAllUsers) {
             console.log("User role does not have permission to list all users.");
             // Return empty list for roles without permission
             return NextResponse.json([]); 
        }
        // If user is STAFF or FACULTY, whereClause remains empty {} to fetch all users.
    }

    if (searchQuery) {
        whereClause.OR = [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { email: { contains: searchQuery, mode: 'insensitive' } },
        ];
    }

    // New: Handle status query for pending count
    if (statusQuery === UserStatus.PENDING_APPROVAL && (requestingUser.role === UserRole.STAFF || requestingUser.role === UserRole.FACULTY)) {
      const pendingCount = await prisma.user.count({
        where: { status: UserStatus.PENDING_APPROVAL },
      });
      return NextResponse.json({ count: pendingCount });
    }

    // Define orderBy clause as an array
    const orderByClause: Prisma.UserOrderByWithRelationInput[] = [];

    // Create the primary sort object
    const primarySort: Prisma.UserOrderByWithRelationInput = {};
    if (allowedSortByFields.includes(validSortBy as keyof Prisma.UserOrderByWithRelationInput)) {
       primarySort[validSortBy as keyof Prisma.UserOrderByWithRelationInput] = sortOrder; 
       orderByClause.push(primarySort);
    } else {
        orderByClause.push({ name: 'asc' }); // Fallback default
    }

    // Add secondary sort for consistency 
    if (validSortBy !== 'email' && validSortBy !== 'id') { // Assuming email/id are unique
        orderByClause.push({ email: 'asc' });
    }

    const users = await prisma.user.findMany({
      where: whereClause, 
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        studentNumber: true,
        contactNumber: true,
        sex: true,
      },
      orderBy: orderByClause,
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("API Error - GET /api/users:", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create a new user (STAFF or FACULTY)
export async function POST(req: NextRequest) {
  // Get current user session
  const session = await getServerSession(authOptions);
  if (!session?.user) { 
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
  }
  const currentUser = session.user;

  // Check if user is STAFF or FACULTY
  const allowedRolesToCreate: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!allowedRolesToCreate.includes(currentUser.role as UserRole)) { 
    return NextResponse.json({ message: 'Unauthorized: STAFF or FACULTY role required' }, { status: 403 });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch { // Changed error to {}
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = AdminUserCreateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    // Destructure including the new optional fields
    const { name, email, password, role, status, sex, studentNumber, contactNumber } = parsedData.data;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return NextResponse.json({ message: 'Email already exists' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await prisma.user.create({
      data: {
        name: name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: role,
        status: status,
        sex: sex,
        studentNumber: studentNumber,
        contactNumber: contactNumber,
      },
      select: {
        id: true, name: true, email: true, role: true, status: true, createdAt: true,
        updatedAt: true
      }
    });

    console.log(`Admin user ${currentUser.email} (Role: ${currentUser.role}) created new user: ${newUser.email}`);
    return NextResponse.json({ message: "User created successfully", user: newUser }, { status: 201 });

  } catch (error) {
    console.error("API Error - POST /api/users:", error);
     if (error instanceof Error && error.message.includes('Unique constraint failed')) {
         return NextResponse.json({ message: 'Email already exists' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 