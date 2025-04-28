import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

const JWT_SECRET = process.env.NEXTAUTH_SECRET; // Re-use the secret from .env

// Define the expected structure of the JWT payload
export interface UserJWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
  iat: number;
  exp: number;
}

/**
 * Verifies the JWT from the Authorization header and returns the decoded payload.
 * Returns null if token is missing, invalid, or expired.
 */
export async function verifyAuthAndGetPayload(req: NextRequest): Promise<UserJWTPayload | null> {
  if (!JWT_SECRET) {
    console.error("Auth Utils Error: JWT_SECRET is not set.");
    return null;
  }

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.split(' ')[1]; // Extract token from "Bearer <token>"

  if (!token) {
    console.log("Auth Utils: No token found in Authorization header.");
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserJWTPayload;
    // Optional: Could add extra validation here if needed (e.g., check against DB)
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
        console.log("Auth Utils: Token expired.");
    } else if (error instanceof jwt.JsonWebTokenError) {
        console.log(`Auth Utils: Invalid token - ${error.message}`);
    } else {
        console.error("Auth Utils: Error verifying token:", error);
    }
    return null;
  }
}

/**
 * Verifies the JWT and checks if the user has STAFF or FACULTY role.
 */
export async function verifyAdminRole(req: NextRequest): Promise<boolean> {
    const payload = await verifyAuthAndGetPayload(req);
    if (!payload) {
        return false; // No valid token means not admin
    }
    const isAdmin = payload.role === UserRole.STAFF || payload.role === UserRole.FACULTY;
    if (!isAdmin) {
        console.log(`Auth Utils: Access denied for user ${payload.userId} with role ${payload.role}. Required STAFF or FACULTY.`);
    }
    return isAdmin;
} 