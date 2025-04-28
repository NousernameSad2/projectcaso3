import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { LoginSchema } from '@/lib/schemas';

// Ensure NEXTAUTH_SECRET is loaded (used as JWT secret here)
const JWT_SECRET = process.env.NEXTAUTH_SECRET;

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

    // 2. Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || !user.password) {
      console.warn(`Login failed: User not found for ${email.toLowerCase()}`);
      return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 }); // Unauthorized
    }

    // 3. Compare password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      console.warn(`Login failed: Incorrect password for ${email.toLowerCase()}`);
      return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 }); // Unauthorized
    }
    
    // Ensure user status is ACTIVE (or adjust logic if PENDING_APPROVAL should log in)
    if (user.status !== 'ACTIVE') {
        console.warn(`Login failed: User status is ${user.status} for ${email.toLowerCase()}`);
        if (user.status === 'PENDING_APPROVAL') {
            return NextResponse.json({ message: 'Account pending admin approval.' }, { status: 403 }); // Forbidden
        }
         return NextResponse.json({ message: 'Account inactive or status issue.' }, { status: 403 }); // Forbidden
    }

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

    // 5. Return token and user data (excluding password)
    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ 
      message: "Login successful", 
      token: token, 
      user: {
        // Return data structure expected by the frontend store
        userId: userWithoutPassword.id,
        email: userWithoutPassword.email,
        role: userWithoutPassword.role,
        name: userWithoutPassword.name,
        // status: userWithoutPassword.status // Include status? 
      }
    });

  } catch (error) {
    console.error("API Error - POST /api/login:", error);
    return NextResponse.json({ message: 'Internal Server Error during login' }, { status: 500 });
  }
} 