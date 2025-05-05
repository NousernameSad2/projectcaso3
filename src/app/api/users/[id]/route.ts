import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AdminUserUpdateSchema } from '@/lib/schemas';
import { UserRole } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

interface RouteContext {
  params: {
    id: string;
  }
}

// Helper function for permission check
async function verifyStaffOrFaculty(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { authorized: false, user: null, response: NextResponse.json({ message: 'Authentication required' }, { status: 401 }) };
    
    const user = session.user;
    const role = user.role as UserRole; // Cast once for clarity

    // Explicitly check if the user's role is one of the allowed roles
    const isAuthorized = role === UserRole.STAFF || role === UserRole.FACULTY;
    
    if (!isAuthorized) {
        return { authorized: false, user: user, response: NextResponse.json({ message: 'Forbidden: Insufficient role' }, { status: 403 }) };
    }
    return { authorized: true, user: user, response: null }; 
}

// GET: Get a specific user by ID (STAFF or FACULTY)
export async function GET(req: NextRequest, { params: { id: userId } }: RouteContext) {
  const authResult = await verifyStaffOrFaculty(req);
  if (!authResult.authorized) return authResult.response;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { // Exclude password, ensure all needed fields are included
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        status: true, 
        createdAt: true, 
        updatedAt: true, 
        studentNumber: true,
        contactNumber: true,
        sex: true
      },
    });

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }
    return NextResponse.json(user);

  } catch (error) {
    console.error(`API Error - GET /api/users/${userId}:`, error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH: Update a specific user (STAFF or FACULTY)
export async function PATCH(req: NextRequest, { params: { id: userId } }: RouteContext) {
  const authResult = await verifyStaffOrFaculty(req);
  if (!authResult.authorized) return authResult.response;
  
  const requestingUser = authResult.user; // Get user from auth result

  try {
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = AdminUserUpdateSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    if (Object.keys(parsedData.data).length === 0) {
        return NextResponse.json({ message: 'No update data provided' }, { status: 400 });
    }

    const updateData = parsedData.data;
    
    // --- Handle FIC Unassignment on Role Change ---
    if (updateData.role && updateData.role !== UserRole.FACULTY) {
      // Check if the user's *current* role is FACULTY
      const currentUserData = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });

      if (currentUserData?.role === UserRole.FACULTY) {
        // If current role is FACULTY and new role is NOT FACULTY, unassign from classes
        console.log(`User ${userId} role changing from FACULTY. Unassigning from classes...`);
        const unassignResult = await prisma.class.updateMany({
          where: { ficId: userId },
          data: { ficId: undefined } // Set ficId to undefined to disconnect/unset optional relation
        });
        console.log(`Unassigned user ${userId} as FIC from ${unassignResult.count} classes.`);
      }
    }
    // --- End Handle FIC Unassignment ---

    // Prepare data, converting empty strings to null for nullable fields
    const dataToUpdate: { [key: string]: any } = {};
    if (updateData.name !== undefined) dataToUpdate.name = updateData.name;
    if (updateData.email !== undefined) dataToUpdate.email = updateData.email.toLowerCase(); // Ensure email is lowercase
    if (updateData.role !== undefined) dataToUpdate.role = updateData.role;
    if (updateData.status !== undefined) dataToUpdate.status = updateData.status;
    if (updateData.sex !== undefined) dataToUpdate.sex = updateData.sex; // Add sex

    // Assign directly, Zod validation already ensures non-empty string
    if (updateData.studentNumber !== undefined) {
        dataToUpdate.studentNumber = updateData.studentNumber;
    }

    // Assign directly, Zod validation already ensures non-empty string
    if (updateData.contactNumber !== undefined) {
        dataToUpdate.contactNumber = updateData.contactNumber;
    }

    // Check if there is actually anything to update
    if (Object.keys(dataToUpdate).length === 0) {
         return NextResponse.json({ message: 'No valid fields provided for update.' }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate, // Use the processed dataToUpdate object
      select: { 
        // Ensure the select matches the UserData type used in the frontend dialog
        id: true, 
        name: true, 
        email: true, 
        role: true, 
        status: true, 
        // Include fields needed for EditUserDialog's initial state if different
        // We should probably also return the updated optional fields
        studentNumber: true,
        contactNumber: true,
        sex: true,
        // Potentially add updatedAt if needed
        updatedAt: true
      },
    });

    console.log(`User ${requestingUser?.email} updated user: ${updatedUser.email}`);
    return NextResponse.json({ message: "User updated successfully", user: updatedUser });

  } catch (error: any) {
    console.error(`API Error - PATCH /api/users/${userId}:`, error);
    if (error.code === 'P2025') { 
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }
    if (error.code === 'P2002') { 
        return NextResponse.json({ message: 'Email already in use by another account' }, { status: 409 });
    } 
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Delete a specific user (STAFF or FACULTY)
export async function DELETE(req: NextRequest, { params: { id: userId } }: RouteContext) {
  const authResult = await verifyStaffOrFaculty(req);
  if (!authResult.authorized) return authResult.response;
  
  const requestingUser = authResult.user; // Get user from auth result

  // Prevent users from deleting themselves
  if (requestingUser?.id === userId) {
      return NextResponse.json({ message: 'You cannot delete your own account.' }, { status: 400 });
  }

  try {
    // --- Pre-deletion Check: Is user an FIC for any class? ---
    const assignedClass = await prisma.class.findFirst({
        where: { ficId: userId },
        select: { id: true, courseCode: true, section: true } // Select minimal fields
    });

    if (assignedClass) {
        console.warn(`Attempt to delete user ${userId} failed: User is FIC for class ${assignedClass.courseCode} ${assignedClass.section} (ID: ${assignedClass.id})`);
        return NextResponse.json(
            { message: `Cannot delete user: They are assigned as Faculty-in-Charge (FIC) for class ${assignedClass.courseCode} ${assignedClass.section}. Please reassign the FIC first.` }, 
            { status: 409 } // 409 Conflict is appropriate
        );
    }
    // --- End Pre-deletion Check ---

    // If no assigned class, proceed with deletion
    await prisma.user.delete({
      where: { id: userId },
    });

    console.log(`User ${requestingUser?.email} deleted user: ${userId}`);
    return new NextResponse(null, { status: 204 }); 

  } catch (error: any) {
    console.error(`API Error - DELETE /api/users/${userId}:`, error);
    
    // Specific check for the User Not Found case
    if (error.code === 'P2025') { 
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }
    
    // Specific check for required relation violation (backup)
    if (error.code === 'P2014') {
        // This should ideally be caught by the pre-check, but handle defensively
        console.error(`Prisma Error P2014 during delete for user ${userId}:`, error.meta);
        return NextResponse.json({ message: 'Cannot delete user: They are required by another record (e.g., assigned as FIC to a class). Please ensure they are unassigned first.' }, { status: 409 });
    }
    
    // Generic check for foreign key constraints (e.g., user in Borrow records)
    if (error.code === 'P2003') {
        console.error(`Prisma Error P2003 during delete for user ${userId}:`, error.meta);
        return NextResponse.json({ message: 'Cannot delete user: They are referenced in other records (e.g., borrow history). Please reassign or delete related records first.' }, { status: 409 }); // Use 409 Conflict here too
    }
    
    // Fallback for other errors
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 