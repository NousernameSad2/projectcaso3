import NextAuth from "next-auth"
import { AuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from '@/lib/prisma'; // Import prisma
import { UserRole } from '@prisma/client'; // Import UserRole if needed for typing

console.log("--- NextAuth Route Handler Loading ---");
console.log("NEXTAUTH_URL:", process.env.NEXTAUTH_URL);
console.log("NEXTAUTH_SECRET Loaded:", !!process.env.NEXTAUTH_SECRET);

// TODO: Configure AuthOptions based on the application's login mechanism
export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: "Credentials",
      // `credentials` is used to generate a form on the sign in page.
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: { label: "Email", type: "email", placeholder: "jsmith@example.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        console.log("[Authorize] Function Start. Credentials:", credentials);

        if (!credentials?.email || !credentials.password) {
          console.error("[Authorize] Missing email or password.");
          // Throw an error that will be shown on the login page
          throw new Error("Please enter both email and password.");
        }

        try {
          const apiUrl = `${process.env.NEXTAUTH_URL}/api/login`;
          console.log("[Authorize] Calling Login API:", apiUrl);
          const loginRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          console.log("[Authorize] Login API Response Status:", loginRes.status);

          // If login API request failed, parse the error message and throw it
          if (!loginRes.ok) {
             console.error("[Authorize] Login API request failed. Status:", loginRes.status);
             let errorMessage = "Login failed due to an unexpected error."; // Default error
             try {
                const errorData = await loginRes.json();
                console.error("[Authorize] Login API Error Data:", errorData);
                // Use the message from the API response if available
                if (errorData?.message) {
                    errorMessage = errorData.message;
                }
             } catch (e) {
                console.error("[Authorize] Failed to parse Login API error response.");
             }
             // Throw the error with the specific message from the API
             throw new Error(errorMessage);
          }

          const loginData = await loginRes.json();
          console.log("[Authorize] Login API Response Data:", JSON.stringify(loginData)); // Log stringified data

          // Check if the expected data structure is returned
          if (!loginData.token || !loginData.user || !loginData.user.userId) {
            console.error("[Authorize] Login API returned invalid data structure (missing token, user, or user.userId).");
            // Throw an error for invalid data structure
            throw new Error("Received invalid data from login service.");
          }

          // Prepare the user object required by NextAuth
          const userObjectToReturn = {
            id: loginData.user.userId,
            name: loginData.user.name,
            email: loginData.user.email,
            // image: loginData.user.image, // Include image if available and needed
            role: loginData.user.role,
            accessToken: loginData.token,
          };
          console.log("[Authorize] Login API success. Returning User Object:", JSON.stringify(userObjectToReturn));
          return userObjectToReturn; // Return the user object on success

        } catch (error: any) {
          // Log any other errors during the process
          console.error("[Authorize] Error during API call or processing:", error);
          // Re-throw the error or throw a generic one
          // If the error already has a message (like the ones we threw above), use it
          throw new Error(error.message || "An unexpected error occurred during authorization.");
        }
      }
    })
  ],
  session: {
    strategy: "jwt", // Use JWT strategy as we handle tokens
  },
  callbacks: {
    async jwt({ token, user, account, profile, trigger, session }) { // Add trigger and session params
      console.log("--- JWT Callback Start ---");
      console.log(`[JWT] Trigger: ${trigger}`); // Log the trigger
      // console.log("[JWT] Incoming Token:", JSON.stringify(token));
      // console.log("[JWT] Incoming User:", JSON.stringify(user));
      // console.log("[JWT] Incoming Account:", JSON.stringify(account));
      // console.log("[JWT] Incoming Session for update:", JSON.stringify(session));

      // Initial sign in: Copy essential data from user object to token
      if (account && user) {
        console.log("[JWT] Initial sign-in detected.");
        return {
          ...token,
          id: user.id,
          role: user.role,
          accessToken: user.accessToken, 
          name: user.name, // Store name directly in token
          email: user.email, // Store email directly in token
        };
      }

      // Handle session updates triggered by useSession().update()
      // Note: This requires client-side code to call update() after a role change
      if (trigger === "update" && session) {
          console.log("[JWT] Update trigger detected. Updating token with session data:", session);
          // Merge the session changes into the token
          token.name = session.user.name;
          token.email = session.user.email;
          token.role = session.user.role; 
          // Potentially update other fields if needed
          console.log("[JWT] Returning updated token after trigger:", JSON.stringify(token));
          return token;
      }

      // --- Refresh token data on subsequent requests --- 
      // Check if token exists and has user ID
      if (token?.id) {
          try {
              // Fetch the latest user data from the database
              const dbUser = await prisma.user.findUnique({
                  where: { id: token.id as string },
                  select: { role: true, name: true, status: true } // Select needed fields
              });

              if (dbUser) {
                 // Update the token with fresh data
                 console.log("[JWT] Refreshing token with DB data for user:", token.id);
                 token.role = dbUser.role;
                 token.name = dbUser.name;
                 // Check for inactive status
                 if (dbUser.status === 'INACTIVE') {
                     console.log(`[JWT] User ${token.id} is INACTIVE. Throwing error.`);
                     throw new Error("User account is inactive."); // Throw error instead of returning null
                 }
              } else {
                 // User not found in DB
                 console.warn("[JWT] User not found in DB during refresh:", token.id);
                 throw new Error("User not found."); // Throw error instead of returning null
              }
          } catch (error) {
              console.error("[JWT] Error during token refresh logic:", error);
              throw error; // Re-throw the error to be handled by NextAuth
          }
      }
      // --- End Refresh --- 

      // Return the potentially refreshed token if no errors were thrown
      console.log("[JWT] Returning final token:", JSON.stringify(token));
      return token;
    },
    async session({ session, token }) {
      console.log("--- Session Callback Start ---");
      // console.log("[Session] Incoming Session:", JSON.stringify(session));
      // console.log("[Session] Incoming Token:", JSON.stringify(token));

      // Ensure session.user exists
      session.user = session.user || {};

      // Add custom properties from the (potentially refreshed) token to the session object
      session.accessToken = token.accessToken as string | undefined;
      session.user.id = token.id as string | undefined;
      session.user.role = token.role as UserRole | undefined; // Use UserRole type
      session.user.name = token.name as string | undefined;
      session.user.email = token.email as string | undefined;

      // console.log("[Session] Returning MODIFIED session object:", JSON.stringify(session));
      return session;
    },
  },
  pages: {
    signIn: '/login', // Redirect users to your custom login page
    // signOut: '/auth/signout',
    // error: '/auth/error', // Error code passed in query string as ?error=
    // verifyRequest: '/auth/verify-request', // (used for email/passwordless login)
    // newUser: '/auth/new-user' // New users will be directed here on first sign in (leave the property out to disable)
  },
  // Add secret for JWT signing
  secret: process.env.NEXTAUTH_SECRET,
  // Enable debug messages in development
  debug: process.env.NODE_ENV === 'development',
};

console.log("--- NextAuth Options Configured ---");

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 