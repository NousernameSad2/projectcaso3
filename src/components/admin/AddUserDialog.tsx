'use client';

import React, { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';
import { UserRole, UserStatus } from '@prisma/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AdminUserCreateSchema } from '@/lib/schemas';
import { PlusCircle } from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Define a type for the data returned for a newly created user
// Should match the DisplayUser type in users/page.tsx or the API select clause
type NewUserData = {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string; // API returns string date
  updatedAt: string; // Added updatedAt
  // Add other fields if necessary, like studentNumber, contactNumber, sex if returned by API and needed by handler
  // Based on GET /api/users select, these are likely NOT returned by default on POST
};

type AddUserDialogProps = {
  onUserAdded: (newUser: NewUserData) => void; // Use the specific type
};

// Define the form schema type based on Zod schema
type AdminUserCreateInput = z.infer<typeof AdminUserCreateSchema>;

export default function AddUserDialog({ onUserAdded }: AddUserDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { data: session, status: sessionStatus } = useSession();

  // Explicitly type useForm with AdminUserCreateInput
  const form = useForm<AdminUserCreateInput>({
    resolver: zodResolver(AdminUserCreateSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: UserRole.REGULAR, // Default role
      status: UserStatus.ACTIVE, // Default status
      sex: undefined, // Explicitly provide default for optional field
      studentNumber: '', // Add default for studentNumber
      contactNumber: '', // Add default for contactNumber
    },
  });

  // Explicitly type the onSubmit handler parameter
  const onSubmit: SubmitHandler<AdminUserCreateInput> = async (values) => {
    const currentToken = session?.accessToken;
    if (!currentToken) {
      if (sessionStatus === 'loading') {
        toast.error('Session is loading, please wait...');
      } else {
        toast.error('Authentication session is invalid. Please log in again.');
      }
      return;
    }
    setIsLoading(true);
    console.log('Submitting new user:', values);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(values),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to add user.');
      }

      toast.success(result.message || 'User added successfully!');
      onUserAdded(result.user); // Pass the new user data back to parent
      form.reset(); // Reset form fields
      setIsOpen(false); // Close the dialog
    } catch (error) {
      // Type checking for error message (safer than just error.message)
      const message = error instanceof Error ? error.message : "An unknown error occurred.";
      console.error('Error adding user:', error);
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const isSessionLoading = sessionStatus === 'loading';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button disabled={isSessionLoading}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>
            Enter the details for the new user. Click save when you&apos;re done.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            {/* Name Field */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} disabled={isLoading || isSessionLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email Field */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="user@example.com" {...field} disabled={isLoading || isSessionLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password Field */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="********" {...field} disabled={isLoading || isSessionLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Student Number Field */}
            <FormField
              control={form.control}
              name="studentNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Student Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 2020-12345" {...field} value={field.value ?? ""} disabled={isLoading || isSessionLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Contact Number Field */}
            <FormField
              control={form.control}
              name="contactNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 09171234567" {...field} value={field.value ?? ""} disabled={isLoading || isSessionLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Role Select */}
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading || isSessionLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(UserRole).map((role) => (
                        <SelectItem key={role} value={role}>
                          {role.charAt(0) + role.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Status Select */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading || isSessionLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(UserStatus).map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())} {/* Format status */}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Sex Select (Optional) */}
            <FormField
              control={form.control}
              name="sex"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sex (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value} disabled={isLoading || isSessionLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select sex (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                       {/* Add an explicit 'None' option or similar if desired, otherwise leaving it unselected means undefined/null */}
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isLoading || isSessionLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || isSessionLoading}>
                {isLoading ? <LoadingSpinner size="sm" /> : 'Save User'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 