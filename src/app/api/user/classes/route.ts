import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route'; // Adjust path if needed

const prisma = new PrismaClient();

export async function GET(request: Request) {
  // 1. Get User Session
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized: User session not found or missing ID.' }, { status: 401 });
  }
  const userId = session.user.id;

  // 2. Fetch User's Class Enrollments and include Class details
  try {
    const enrollments = await prisma.userClassEnrollment.findMany({
      where: {
        userId: userId,
        // Optionally filter for active classes if needed
        // class: {
        //   isActive: true,
        // }
      },
      include: {
        class: true, // Include the full Class object
      },
      orderBy: {
        // Optional: Order classes consistently
        class: {
           courseCode: 'asc', 
        }
      }
    });

    // Extract just the class data from the enrollments, filtering out any nulls
    const userClasses = enrollments
      .map(enrollment => enrollment.class)
      .filter(Boolean); // Add this filter to remove null/undefined classes

    // 3. Return the list of classes
    return NextResponse.json(userClasses);

  } catch (error) {
    console.error('Failed to fetch user classes:', error);
    return NextResponse.json({ error: 'Database error occurred while fetching classes.' }, { status: 500 });
  }
} 