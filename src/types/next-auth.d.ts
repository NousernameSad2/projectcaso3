import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";
import { UserRole } from "@prisma/client"; // Assuming UserRole comes from Prisma

// Extend the default JWT type
declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string; // Add user ID
    role?: UserRole; // Add user role
    accessToken?: string; // Add access token
    // Add any other properties you put in the token in the jwt callback
  }
}

// Extend the default Session type
declare module "next-auth" {
  interface Session {
    accessToken?: string; // Add access token to the session
    user?: {
      id?: string; // Add user ID to the session user
      role?: UserRole; // Add user role to the session user
      // Add any other properties you want exposed to the client session
    } & DefaultSession["user"]; // Keep the default user properties (name, email, image)
  }

  // Optional: Extend the default User type if you need to add properties
  // directly to the user object returned by the authorize callback
  // or other providers. This is often less necessary if using JWT strategy,
  // as the JWT callback is the primary place to shape the token.
  interface User extends DefaultUser {
    role?: UserRole;
    accessToken?: string;
    // Add properties returned by the authorize callback
  }
} 