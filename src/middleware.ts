export { default } from "next-auth/middleware"

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
     * - Any other public pages (e.g., /public/*, /)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|login|register).*)',
  ],
} 