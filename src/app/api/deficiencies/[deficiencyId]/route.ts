import { NextResponse } from 'next/server';
import { PrismaClient, DeficiencyStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const prismaClient = new PrismaClient();

interface SessionUser {
  id: string;
  role: UserRole;
}

// Zod schema for updating (resolving) a deficiency
const resolveDeficiencySchema = z.object({
  status: z.literal(DeficiencyStatus.RESOLVED), // Only allow setting to RESOLVED here
  resolution: z.string().optional(), // Optional resolution notes
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ deficiencyId: string }> }) {
  const params = await context.params;
  const deficiencyId = params.deficiencyId;
  // 1. Get User Session and Check Permissions (Staff/Faculty can resolve)
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // --- Permission Check --- 
  const allowedRoles: UserRole[] = [UserRole.STAFF, UserRole.FACULTY];
  if (!user.role || !allowedRoles.includes(user.role)) { 
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions.' }, { status: 403 });
  }
  // --- End Permission Check --- 

  // 2. Parse and Validate Request Body (must include status: RESOLVED)
  let validatedData;
  try {
    const body = await request.json();
    validatedData = resolveDeficiencySchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  const { status, resolution } = validatedData;

  // 4. Update Deficiency Record
  try {
    // Check if deficiency exists and is in a state that can be resolved
    const currentDeficiency = await prismaClient.deficiency.findUnique({
        where: { id: deficiencyId },
        select: { status: true }
    });

    if (!currentDeficiency) {
       return NextResponse.json({ error: `Deficiency with ID ${deficiencyId} not found.` }, { status: 404 });
    }

    if (currentDeficiency.status === DeficiencyStatus.RESOLVED) {
        return NextResponse.json({ message: 'Deficiency is already resolved.', status: currentDeficiency.status }, { status: 200 }); // Or 400 Bad Request?
    }

    // Perform the update
    const updatedDeficiency = await prismaClient.deficiency.update({
      where: { id: deficiencyId },
      data: {
        status: status,       // Should always be RESOLVED based on schema
        resolution: resolution,
        // updatedBy: user.id, // Optional: track who resolved it
      },
    });

    // 5. Return Success Response
    return NextResponse.json(updatedDeficiency);

  } catch (error: unknown) {
    console.error(`Failed to update deficiency ${deficiencyId}:`, error);
    // Handle potential Prisma errors (e.g., record not found during update - though checked above)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return NextResponse.json({ error: `Deficiency with ID ${deficiencyId} not found.` }, { status: 404 });
    }
    return NextResponse.json({ error: 'Database error occurred while resolving deficiency.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ deficiencyId: string }> }) {
    const params = await context.params;
    const deficiencyId = params.deficiencyId;
    // 1. Get User Session & Authorization
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;
    
    // Only allow Staff or Faculty to delete
    if (!user?.id || !(user.role === UserRole.STAFF || user.role === UserRole.FACULTY)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!deficiencyId) {
        return NextResponse.json({ error: 'Deficiency ID is required' }, { status: 400 });
    }

    try {
        // 2. Find the deficiency to ensure it exists before deleting
        const deficiency = await prisma.deficiency.findUnique({
            where: { id: deficiencyId },
        });

        if (!deficiency) {
            return NextResponse.json({ error: 'Deficiency record not found' }, { status: 404 });
        }

        // 3. Delete the deficiency
        await prisma.deficiency.delete({
            where: { id: deficiencyId },
        });

        // 4. Return Success Response
        console.log(`Deficiency ${deficiencyId} deleted by user ${user.id}`);
        return NextResponse.json({ message: 'Deficiency record deleted successfully' });

    } catch (error) {
        console.error(`Failed to delete deficiency ${deficiencyId}:`, error);
        // Handle potential Prisma errors (e.g., record not found if check failed somehow)
        if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
            return NextResponse.json({ error: 'Deficiency record not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'An error occurred while deleting the deficiency record.' }, { status: 500 });
    }
} 