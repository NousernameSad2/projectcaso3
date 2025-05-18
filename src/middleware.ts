import { NextResponse } from 'next/server';
// import type { NextRequest } from 'next/server'; // Removed unused NextRequest
import { withAuth } from "next-auth/middleware";
import { UserRole } from '@prisma/client'; // Import UserRole if you have it defined

export default withAuth(
  // `withAuth` augments your `Request` with the user's token.
  function middleware(req) {
    // Check if the user is trying to access the reports page
    if (req.nextUrl.pathname.startsWith('/reports')) {
      // Check if the user is authenticated and their role
      const userRole = req.nextauth.token?.role;

      if (userRole === UserRole.REGULAR) {
        // Redirect REGULAR users away from /reports to the home page (or an access denied page)
        // console.log(`[Middleware] REGULAR user ${req.nextauth.token?.email} attempted to access /reports. Redirecting.`);
        return NextResponse.redirect(new URL('/', req.url));
      }
      // If user is STAFF or FACULTY, or not authenticated (letting NextAuth handle default auth redirect), allow access
    }

    // For any other page that matches the config, default behavior (authentication check) applies
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token, // Ensures user is authenticated for all matched routes
    },
    // Configure pages for NextAuth (if not already in your main NextAuth config)
    // pages: {
    //   signIn: '/login',
    //   error: '/auth/error', // Error page if authorization fails
    // },
  }
);

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (the login page itself)
     * - register (the register page)
     * - images (static image assets)
     * - Any other public pages (e.g., /public/*, /)
     * - root path '/' (if it should be public, otherwise remove if you want to protect it too)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|login|register|images|$).*)', // Adjusted to ensure root '/' is not matched by default if it's public. 
                                                                              // If you want to protect the homepage, remove the '|$' part and ensure it's not in the negative lookahead.
  ],
}; 