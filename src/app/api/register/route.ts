import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { RegistrationSchema } from '@/lib/schemas';
import { UserStatus } from '@prisma/client'; // Import UserStatus enum

const SALT_ROUNDS = 10;

export async function POST(req: NextRequest) {
  console.log("--- POST /api/register request received ---");
  try {
    // 1. Parse and Validate Request Body
    let body;
    try {
      body = await req.json();
      console.log("Received Body:", JSON.stringify(body)); // Log the raw body
    } catch (error) {
      console.error("Error parsing JSON body:", error);
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedData = RegistrationSchema.safeParse(body);

    if (!parsedData.success) {
      console.error("Registration Validation Errors:", parsedData.error.flatten());
      return NextResponse.json({ message: 'Invalid input', errors: parsedData.error.flatten().fieldErrors }, { status: 400 });
    }
    
    console.log("Parsed Data (Success):", JSON.stringify(parsedData.data));
    const { name, email, password, studentNumber, contactNumber, sex } = parsedData.data;

    // 2. Check if email already exists
    console.log(`Checking for existing user with email: ${email.toLowerCase()}`);
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }, // Check case-insensitive
    });

    if (existingUser) {
      console.log(`User found with email: ${email.toLowerCase()}`);
      return NextResponse.json({ message: 'Email already registered' }, { status: 409 }); // 409 Conflict
    }
    console.log(`No existing user found for email: ${email.toLowerCase()}`);

    // 3. Hash the password
    console.log("Hashing password...");
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    console.log("Password hashed.");

    // 4. Determine user status based on email domain
    const emailDomain = email.split('@')[1];
    const initialStatus = emailDomain === 'up.edu.ph' ? UserStatus.ACTIVE : UserStatus.PENDING_APPROVAL;
    console.log(`Email domain: ${emailDomain}, Determined initial status: ${initialStatus}`);
    const statusMessage = initialStatus === UserStatus.ACTIVE 
        ? "Registration successful! You can now log in."
        : "Registration successful! Your account requires admin approval.";

    // 5. Create the user
    console.log("Attempting to create user in database...");
    const newUser = await prisma.user.create({
      data: {
        name: name,
        email: email.toLowerCase(), // Store email in lowercase
        password: hashedPassword,
        status: initialStatus,
        studentNumber: studentNumber,
        contactNumber: contactNumber,
        sex: sex,
        // Role defaults to REGULAR as per schema
      },
      // Select only safe fields to return (optional)
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true, 
        createdAt: true,
      }
    });

    console.log(`New user created: ${newUser.email}, Status: ${newUser.status}, ID: ${newUser.id}`);

    // 6. Return Success Response
    return NextResponse.json(
      { message: statusMessage, user: newUser }, 
      { status: 201 }
    );

  } catch (error) {
    console.error("API Error - POST /api/register:", error);
    // Handle potential Prisma unique constraint errors or other issues
    if (error instanceof Error && error.message.includes('Unique constraint failed')) {
         return NextResponse.json({ message: 'Email already registered' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error during registration' }, { status: 500 });
  }
} 