import NextAuth from "next-auth"
// Remove AuthOptions import from next-auth if it's only used for the local type
// import { AuthOptions } from "next-auth" 
import { authOptions } from "@/lib/authOptions"; // Import from the new location
// Remove other direct imports for prisma, UserRole if they are now solely handled within authOptions.ts
// import { prisma } from '@/lib/prisma'; 
// import { UserRole } from '@prisma/client';

console.log("--- NextAuth Route Handler Loading (after refactor) ---");
console.log("NEXTAUTH_URL:", process.env.NEXTAUTH_URL);
console.log("NEXTAUTH_SECRET Loaded:", !!process.env.NEXTAUTH_SECRET);

// The actual authOptions object is now imported
// No need to define it here anymore

console.log("--- NextAuth Options Imported and Ready ---");

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 