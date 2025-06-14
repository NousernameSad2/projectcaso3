"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import Link from 'next/link';
import Image from 'next/image'; // Import Image
import { signIn } from "next-auth/react";
import { useRouter } from 'next/navigation'; // Import useRouter

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"; // Import Card components
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"; // Import Dialog components
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoginSchema } from "@/lib/schemas";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false); // New state for redirection
  const [error, setError] = useState<string | null>(null);
  const router = useRouter(); // Initialize router

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof LoginSchema>) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false, // <-- IMPORTANT: Don't redirect automatically
        // callbackUrl is not needed here since we handle it manually
      });

      if (result?.error) {
        setError(result.error || "An unexpected error occurred during login.");
      } else if (result?.ok) {
        // --- Successful Login ---
        setIsRedirecting(true); // Set redirecting state
        // Manually redirect to the intended page
        router.push('/'); // Or use the callbackUrl from query params if needed
      } else {
        // This case might be hit if the signIn promise resolves without ok/error,
        // which can happen in some edge cases.
        setError("Login attempt was not successful. Please check credentials or try again.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again later.");
    } finally {
      // Don't set isLoading to false if we are redirecting
      if (!isRedirecting) {
        setIsLoading(false);
      }
    }
  }

  return (
    // Main container with white background, centered content
    <main 
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{
        backgroundImage: "url('/images/authbg.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Card className="w-full max-w-md shadow-lg"> 
        <CardHeader className="items-center text-center space-y-4"> {/* Center header content */} 
          {/* Logo */}
          <Image 
            src="/images/logo.png" // ASSUMPTION: Logo exists here
            alt="Company Logo"
            width={80} // Adjust width as needed
            height={80} // Adjust height as needed
            className="mb-4" // Add some margin below logo
            priority // Prioritize loading logo
            unoptimized
          />
          <CardTitle className="text-2xl font-semibold">Welcome Back</CardTitle>
          <CardDescription>Enter your credentials to login.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder="name@example.com" 
                        {...field} 
                        disabled={isLoading || isRedirecting} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="********" 
                        {...field} 
                        disabled={isLoading || isRedirecting} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Forgot Password Link & Dialog */} 
              <div className="text-right">
                 <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="link" className="text-sm font-medium px-0 h-auto py-0 text-primary hover:underline"> 
                        Forgot Password?
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]"> 
                      <DialogHeader>
                        <DialogTitle>Password Reset</DialogTitle>
                        <DialogDescription>
                          Please contact the DGE administrator at facilities.dge@up.edu.ph for password assistance.
                        </DialogDescription>
                      </DialogHeader>
                       {/* Optional: Add a close button if needed, DialogClose is often used */}
                       {/* <DialogFooter>
                         <DialogClose asChild>
                           <Button type="button" variant="secondary">Close</Button>
                         </DialogClose>
                       </DialogFooter> */}
                    </DialogContent>
                  </Dialog>
              </div>

              {error && (
                <p className="text-sm font-medium text-destructive text-center pt-1">{error}</p>
              )}

              <Button type="submit" className="w-full h-10 mt-6" disabled={isLoading || isRedirecting}>
                {isLoading ? "Logging in..." : isRedirecting ? "Redirecting..." : "Login"}
              </Button>
            </form>
          </Form>
        </CardContent>
         {/* Moved Register link outside CardContent but logically grouped */}
         <p className="mt-6 mb-8 text-center text-sm text-muted-foreground">
           Don&apos;t have an account?{" "}
           <Link href="/register" className={`font-medium text-primary hover:underline ${isLoading || isRedirecting ? 'pointer-events-none opacity-50' : ''}`}>
             Register
           </Link>
         </p>
      </Card>
    </main>
  );
} 