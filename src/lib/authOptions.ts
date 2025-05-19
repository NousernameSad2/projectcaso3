import { AuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from '@/lib/prisma'; 
import { UserRole } from '@prisma/client'; 

console.log("--- Shared AuthOptions Loading ---"); // Log when this module is loaded
console.log("NEXTAUTH_URL (from authOptions.ts):", process.env.NEXTAUTH_URL);
console.log("NEXTAUTH_SECRET Loaded (from authOptions.ts):", !!process.env.NEXTAUTH_SECRET);

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "jsmith@example.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        console.log("[Authorize Shared] Function Start. Credentials:", credentials);

        if (!credentials?.email || !credentials.password) {
          console.error("[Authorize Shared] Missing email or password.");
          throw new Error("Please enter both email and password.");
        }

        try {
          const apiUrl = `${process.env.NEXTAUTH_URL}/api/login`;
          console.log("[Authorize Shared] Calling Login API:", apiUrl);
          const loginRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          console.log("[Authorize Shared] Login API Response Status:", loginRes.status);

          if (!loginRes.ok) {
             console.error("[Authorize Shared] Login API request failed. Status:", loginRes.status);
             let errorMessage = "Login failed due to an unexpected error.";
             try {
                const errorData = await loginRes.json();
                console.error("[Authorize Shared] Login API Error Data:", errorData);
                if (errorData?.message) {
                    errorMessage = errorData.message;
                }
             } catch {
                console.error("[Authorize Shared] Failed to parse Login API error response.");
             }
             throw new Error(errorMessage);
          }

          const loginData = await loginRes.json();
          console.log("[Authorize Shared] Login API Response Data:", JSON.stringify(loginData));

          if (!loginData.token || !loginData.user || !loginData.user.userId) {
            console.error("[Authorize Shared] Login API returned invalid data structure.");
            throw new Error("Received invalid data from login service.");
          }

          const userObjectToReturn = {
            id: loginData.user.userId,
            name: loginData.user.name,
            email: loginData.user.email,
            role: loginData.user.role,
            accessToken: loginData.token,
          };
          console.log("[Authorize Shared] Login API success. Returning User Object:", JSON.stringify(userObjectToReturn));
          return userObjectToReturn;

        } catch (error: unknown) {
          console.error("[Authorize Shared] Error during API call or processing:", error);
          const message = error instanceof Error ? error.message : "An unexpected error occurred during authorization.";
          throw new Error(message);
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      console.log("--- JWT Callback Start (Shared) ---");
      console.log(`[JWT Shared] Trigger: ${trigger}`);
      
      if (account && user) {
        console.log("[JWT Shared] Initial sign-in detected.");
        return {
          ...token,
          id: user.id,
          role: user.role,
          accessToken: user.accessToken, 
          name: user.name,
          email: user.email,
        };
      }

      if (trigger === "update" && session) {
          console.log("[JWT Shared] Update trigger detected. Updating token with session data:", session);
          token.name = session.user.name;
          token.email = session.user.email;
          token.role = session.user.role; 
          console.log("[JWT Shared] Returning updated token after trigger:", JSON.stringify(token));
          return token;
      }

      if (token?.id) {
          let retries = 1; // Max 1 retry (total 2 attempts)
          let dbUserFetched = false;

          while (retries >= 0 && !dbUserFetched) {
              try {
                  const dbUser = await prisma.user.findUnique({
                      where: { id: token.id as string },
                      select: { role: true, name: true, status: true }
                  });

                  if (dbUser) {
                     console.log(`[JWT Shared] DB user data fetched successfully for ${token.id} on attempt.`);
                     token.role = dbUser.role;
                     token.name = dbUser.name;
                     if (dbUser.status === 'INACTIVE') {
                         console.log(`[JWT Shared] User ${token.id} is INACTIVE. Throwing error.`);
                         throw new Error("User account is inactive."); // Non-retryable error
                     }
                     dbUserFetched = true; // Mark as fetched to exit loop
                  } else {
                     console.warn(`[JWT Shared] User not found in DB during refresh for ${token.id}.`);
                     throw new Error("User not found."); // Non-retryable error
                  }
              } catch (error: unknown) {
                  let errorMessage = "An unknown error occurred during token refresh.";
                  if (error instanceof Error) {
                      errorMessage = error.message;
                  }
                  console.error(`[JWT Shared] Error during token refresh logic (retries left: ${retries}):`, errorMessage);
                  if (errorMessage === "User account is inactive." || errorMessage === "User not found.") {
                      throw error; // Re-throw non-retryable errors immediately
                  }
                  if (retries === 0) {
                      console.error(`[JWT Shared] All retries failed for ${token.id}. Re-throwing last error.`);
                      throw error; // All retries failed, re-throw the last error
                  }
                  // Wait a bit before retrying for transient errors
                  await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay
                  retries--;
              }
          }
      }
      console.log("[JWT Shared] Returning final token:", JSON.stringify(token));
      return token;
    },
    async session({ session, token }) {
      console.log("--- Session Callback Start (Shared) ---");
      session.user = session.user || {};
      session.accessToken = token.accessToken as string | undefined;
      session.user.id = token.id as string | undefined;
      session.user.role = token.role as UserRole | undefined;
      session.user.name = token.name as string | undefined;
      session.user.email = token.email as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
}; 