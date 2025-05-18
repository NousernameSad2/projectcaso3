import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import { AdminChangePasswordSchema } from '@/lib/schemas';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client'; // Assuming UserRole is from prisma client

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ userId: string }> } // params is a Promise
) {
    const session = await getServerSession(authOptions);

    // 1. Authorization: Check if user is authenticated and is an admin
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized: Not logged in' }, { status: 401 });
    }

    // Check for admin role (STAFF or FACULTY)
    const isAdmin = session.user.role === UserRole.STAFF || session.user.role === UserRole.FACULTY;
    if (!isAdmin) {
        return NextResponse.json({ message: 'Forbidden: Insufficient privileges' }, { status: 403 });
    }

    const params = await context.params; // Await the params object
    const { userId: targetUserId } = params; // Destructure userId from the resolved params

    if (!targetUserId) {
        return NextResponse.json({ message: 'User ID parameter is missing' }, { status: 400 });
    }

    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
        }

        // 2. Validate input using the new schema
        const parsedData = AdminChangePasswordSchema.safeParse(body);

        if (!parsedData.success) {
            console.error("Admin Change Password Validation Errors:", parsedData.error.flatten());
            return NextResponse.json(
                { message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        const { newPassword } = parsedData.data;

        // 3. Fetch the target user
        const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
        });

        if (!targetUser) {
            return NextResponse.json({ message: 'Target user not found' }, { status: 404 });
        }
        
        // Optional: Prevent admins from changing other admins' passwords (or their own via this route)
        // if (targetUser.role === UserRole.STAFF || targetUser.role === UserRole.FACULTY) {
        //     // Or specifically if targetUserId === session.user.id
        //     return NextResponse.json({ message: 'Cannot change password for this user account via this route' }, { status: 403 });
        // }


        // 4. Hash the new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // 5. Update the user's password
        await prisma.user.update({
            where: { id: targetUserId },
            data: {
                password: hashedNewPassword,
                // Potentially also update updatedAt or add a field like passwordLastChangedByAdmin
            },
        });

        console.log(`Admin ${session.user.id} successfully changed password for user ${targetUserId}.`);
        return NextResponse.json({ message: 'Password changed successfully by admin' }, { status: 200 });

    } catch (error) {
        console.error(`Error changing password for user ${targetUserId} by admin ${session.user.id}:`, error);
        return NextResponse.json({ message: 'Error changing password' }, { status: 500 });
    }
} 