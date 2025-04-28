"use client"; // Required for react-hook-form

import { useState } from "react"; // Import useState
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useRouter } from 'next/navigation'; // Import useRouter for redirection
import Link from 'next/link'; // Import Link for the login link
import Image from 'next/image'; // Import Image

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"; // Import Card components
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RegistrationSchema } from "@/lib/schemas"; // Import the schema
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function RegisterPage() {
  const router = useRouter(); // Initialize router
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 1. Define your form.
  const form = useForm<z.infer<typeof RegistrationSchema>>({
    resolver: zodResolver(RegistrationSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      studentNumber: "",
      contactNumber: "",
      sex: undefined,
    },
  });

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof RegistrationSchema>) {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    console.log("Submitting registration:", values);

    try {
      // Send the full values object including confirmPassword for validation
      // const { confirmPassword, ...dataToSend } = values; // REMOVE THIS LINE

      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values), // Send full 'values' object
      });

      const data = await response.json();
      console.log("API Response:", data);

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      // Registration successful
      setSuccessMessage(data.message || "Registration successful! Please check your email or wait for approval.");
      form.reset(); // Clear the form
      // Optional: Redirect after a delay or keep the message
      // setTimeout(() => router.push('/login'), 3000); 

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      setError(errorMessage);
      console.error("Registration Error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    // Main container with white background, centered content
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-white dark:bg-gray-950">
      <Card className="w-full max-w-md shadow-lg"> 
        <CardHeader className="items-center text-center space-y-4"> 
          {/* Logo */}
          <Image 
            src="/images/logo.png" // ASSUMPTION: Logo exists here
            alt="Company Logo"
            width={80} // Adjust width as needed
            height={80} // Adjust height as needed
            className="mb-4"
            priority
          />
          <CardTitle className="text-2xl font-semibold">Create Account</CardTitle>
          <CardDescription>Enter your details to register.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Juan dela Cruz" {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="studentNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Student Number (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 2020-12345" {...field} value={field.value ?? ""} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Number (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 09171234567" {...field} value={field.value ?? ""} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sex</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select sex" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                      </SelectContent>
                    </Select>
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
                      <Input type="password" placeholder="********" {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="********" {...field} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <p className="text-sm font-medium text-destructive text-center pt-1">{error}</p>
              )}
              {successMessage && (
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-500 text-center pt-1">{successMessage}</p>
              )}

              <Button type="submit" className="w-full h-10 mt-6" disabled={isLoading || !!successMessage}>
                {isLoading ? "Registering..." : "Register"}
              </Button>
            </form>
          </Form>
        </CardContent>
         {/* Moved Login link outside CardContent */}
         <p className="mt-6 mb-8 text-center text-sm text-muted-foreground">
           Already have an account?{" "}
           <Link href="/login" className={`font-medium text-primary hover:underline ${isLoading ? 'pointer-events-none opacity-50' : ''}`}>
             Login
           </Link>
         </p>
      </Card>
    </main>
  );
} 