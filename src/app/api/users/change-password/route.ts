import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import { ChangePasswordBaseSchema } from '@/lib/schemas';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
        }

        // Validate using the base schema without the refine rule
        // We only need currentPassword and newPassword for backend logic
        const parsedData = ChangePasswordBaseSchema.pick({ currentPassword: true, newPassword: true }).safeParse(body);

        if (!parsedData.success) {
             console.error("Change Password Validation Errors:", parsedData.error.flatten());
            // Return specific field errors if possible
            return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
        }

        const { currentPassword, newPassword } = parsedData.data;

        // Fetch user including password hash
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user || !user.password) {
            // Should not happen if user is authenticated, but good practice
            console.warn(`User ${userId} attempted password change but user or password hash not found.`);
            return NextResponse.json({ message: 'User not found' }, { status: 404 });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

        if (!isCurrentPasswordValid) {
            console.warn(`User ${userId} provided incorrect current password during password change.`);
            return NextResponse.json({ message: 'Incorrect current password' }, { status: 401 }); // Use 401 or 400 depending on security preference
        }

        // Hash the new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10); // Use appropriate salt rounds (e.g., 10-12)

        // Update the user's password
        await prisma.user.update({
            where: { id: userId },
            data: {
                password: hashedNewPassword,
            },
        });

        console.log(`User ${userId} successfully changed their password.`);
        return NextResponse.json({ message: 'Password changed successfully' }, { status: 200 });

    } catch (error) {
        console.error('Error changing password for user', userId, ':', error);
        // Avoid leaking specific error details
        return NextResponse.json({ message: 'Error changing password' }, { status: 500 });
    }
} 