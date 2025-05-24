import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { UserRole } from '@prisma/client';

interface SessionUser {
  id: string;
  role: UserRole;
}

export async function GET(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user?.id || (user.role !== UserRole.STAFF && user.role !== UserRole.FACULTY && user.role !== UserRole.REGULAR)) {
    // Allowing REGULAR role too, as they might be part of a group and modal is on MyBorrows
    // However, this specific API to fetch emails might be better restricted to staff/faculty if it's only for them to initiate data requests.
    // For now, let's assume any authenticated user involved in the modal can trigger this, reconsider if needed.
    return NextResponse.json({ error: 'Unauthorized or insufficient permissions' }, { status: 401 });
  }

  const params = await context.params;
  const groupId = params.groupId;
  if (!groupId) {
    return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
  }

  try {
    const groupMates = await prisma.borrowGroupMate.findMany({
      where: { borrowGroupId: groupId },
      include: {
        user: { select: { email: true, id: true } }, // Include id for filtering out the current user if needed, though not strictly necessary for email list
      },
    });

    const emails = groupMates
      .map(gm => gm.user.email)
      .filter((email): email is string => email !== null && email !== undefined); // Ensure emails are strings and not null/undefined
    
    return NextResponse.json(emails);

  } catch (error) {
    console.error(`Failed to fetch member emails for group ${groupId}:`, error);
    return NextResponse.json({ error: 'An error occurred while fetching group member emails.' }, { status: 500 });
  }
} 