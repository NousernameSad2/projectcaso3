import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { LoginSchema } from '@/lib/schemas';

// Ensure NEXTAUTH_SECRET is loaded (used as JWT secret here)
const JWT_SECRET = process.env.NEXTAUTH_SECRET;

// Constants for brute force protection
const MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT = 3;
const INITIAL_LOCKOUT_SECONDS = 10;

export async function POST(req: NextRequest) {
  if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET (NEXTAUTH_SECRET) is not set in environment variables.");
    return NextResponse.json({ message: 'Server configuration error.' }, { status: 500 });
  }

  try {
    // 1. Parse and Validate Request Body
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = LoginSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }

    const { email, password } = parsedData.data;
    const userEmail = email.toLowerCase();

    // 2. Find user by email
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    // Handle case where user is not found early to avoid unnecessary checks
    if (!user || !user.password) {
      console.warn(`Login failed: User not found for ${userEmail}`);
      // Still return a generic message to prevent email enumeration
      return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 }); 
    }

    // --- BRUTE FORCE CHECK --- 
    const now = new Date();
    if (user.lockoutUntil && user.lockoutUntil > now) {
        const remainingSeconds = Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / 1000);
        console.warn(`Login attempt failed for ${userEmail}: Account locked. Remaining: ${remainingSeconds}s`);
        return NextResponse.json(
            { message: `Account locked due to too many failed attempts. Please try again in ${remainingSeconds} seconds.` }, 
            { status: 429 } // 429 Too Many Requests
        );
    }
    // --- END BRUTE FORCE CHECK ---

    // 3. Compare password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      console.warn(`Login failed: Incorrect password for ${userEmail}`);
      
      // --- HANDLE FAILED ATTEMPT --- 
      const currentAttempts = user.failedLoginAttempts ?? 0;
      const newAttempts = currentAttempts + 1;
      let newLockoutUntil: Date | null = user.lockoutUntil;

      // Check if this failed attempt triggers a lockout
      if (newAttempts % MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT === 0) {
          const lockoutMultiplier = Math.floor(newAttempts / MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT);
          const lockoutSeconds = INITIAL_LOCKOUT_SECONDS * Math.pow(2, lockoutMultiplier - 1);
          newLockoutUntil = new Date(now.getTime() + lockoutSeconds * 1000);
          console.log(`Lockout triggered for ${userEmail}. Attempts: ${newAttempts}. Lockout until: ${newLockoutUntil.toISOString()} (${lockoutSeconds}s)`);
      }

      // Update user record
      await prisma.user.update({
          where: { id: user.id },
          data: {
              failedLoginAttempts: newAttempts,
              lockoutUntil: newLockoutUntil,
          },
      });
      // --- END HANDLE FAILED ATTEMPT ---

      // Return appropriate error (lockout message if just triggered)
      if (newLockoutUntil && newLockoutUntil > now) {
           const remainingSeconds = Math.ceil((newLockoutUntil.getTime() - now.getTime()) / 1000);
            return NextResponse.json(
                { message: `Invalid email or password. Account locked due to too many failed attempts. Please try again in ${remainingSeconds} seconds.` }, 
                { status: 429 } // Return 429 if locked
            );
      }

      // Otherwise, return generic invalid credentials error
      return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 }); // Unauthorized
    }
    
    // --- Check User Status AFTER successful password match ---
    if (user.status !== 'ACTIVE') {
        console.warn(`Login failed: User status is ${user.status} for ${userEmail}`);
        if (user.status === 'PENDING_APPROVAL') {
            return NextResponse.json({ message: 'Account pending admin approval.' }, { status: 403 }); // Forbidden
        }
         return NextResponse.json({ message: 'Account inactive or status issue.' }, { status: 403 }); // Forbidden
    }

    // --- RESET FAILED ATTEMPTS ON SUCCESS --- 
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
        console.log(`Login successful for ${userEmail}. Resetting failed attempts/lockout.`);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                lockoutUntil: null, // Use null to clear the date
            },
        });
    }
    // --- END RESET --- 

    // 4. Generate JWT
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      // Add other relevant claims if needed, but keep payload small
    };

    const token = jwt.sign(payload, JWT_SECRET, { 
      expiresIn: '1d' // Example: token expires in 1 day
    });

    console.log(`Login successful, token generated for ${user.email}`);

    // 5. Return token and user data (excluding password and brute force fields)
    const { password: _, failedLoginAttempts, lockoutUntil, ...userWithoutSensitiveData } = user;
    return NextResponse.json({ 
      message: "Login successful", 
      token: token, 
      user: {
        // Return data structure expected by the frontend store
        userId: userWithoutSensitiveData.id,
        email: userWithoutSensitiveData.email,
        role: userWithoutSensitiveData.role,
        name: userWithoutSensitiveData.name,
        // status: userWithoutSensitiveData.status // Include status? 
      }
    });

  } catch (error) {
    console.error("API Error - POST /api/login:", error);
    return NextResponse.json({ message: 'Internal Server Error during login' }, { status: 500 });
  }
} 