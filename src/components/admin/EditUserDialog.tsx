'use client';

import React, { useState, useEffect } from 'react';
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
  // DialogTrigger, // Trigger will be handled manually by parent
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
import { AdminUserUpdateSchema } from '@/lib/schemas';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Define the type for the user data passed in
interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  studentNumber?: string | null;
  contactNumber?: string | null;
  sex?: 'Male' | 'Female' | null;
}

type EditUserDialogProps = {
  user: UserData | null; // User to edit, or null if not editing
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onUserUpdated: (updatedUser: UserData) => void; // Callback for successful update
};

// Define the form schema type based on Zod schema
type AdminUserUpdateInput = z.infer<typeof AdminUserUpdateSchema>;

export default function EditUserDialog({ 
  user, 
  isOpen, 
  onOpenChange, 
  onUserUpdated 
}: EditUserDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const { data: session, status: sessionStatus } = useSession();

  const form = useForm<AdminUserUpdateInput>({
    resolver: zodResolver(AdminUserUpdateSchema),
    // Default values will be set via reset based on the user prop
  });

  // Effect to reset the form when the user prop changes or dialog opens
  useEffect(() => {
    if (user && isOpen) {
      form.reset({
        name: user.name ?? '',
        email: user.email ?? '',
        role: user.role,
        status: user.status,
        studentNumber: user.studentNumber ?? '',
        contactNumber: user.contactNumber ?? '',
        sex: user.sex ?? undefined,
      });
    } else if (!isOpen) {
        // Optional: Reset form when dialog closes to clear validation errors
        form.reset({});
    }
  }, [user, isOpen, form]);

  const onSubmit: SubmitHandler<AdminUserUpdateInput> = async (values) => {
    if (!user) {
      toast.error('No user selected for editing.');
      return;
    }
    const currentToken = session?.accessToken;
    if (!currentToken) {
      if (sessionStatus === 'loading') {
          toast.error('Session is loading, please wait...');
      } else {
          toast.error('Authentication session is invalid. Please log in again.');
      }
      return;
    }
    
    // Filter out fields that haven't changed from the original user data
    const changedValues: Partial<AdminUserUpdateInput> = {};
    if (values.name !== (user.name ?? '')) changedValues.name = values.name;
    if (values.email !== (user.email ?? '')) changedValues.email = values.email;
    if (values.role !== user.role) changedValues.role = values.role;
    if (values.status !== user.status) changedValues.status = values.status;
    if (values.studentNumber !== (user.studentNumber ?? '')) changedValues.studentNumber = values.studentNumber;
    if (values.contactNumber !== (user.contactNumber ?? '')) changedValues.contactNumber = values.contactNumber;
    if (values.sex !== (user.sex ?? undefined)) changedValues.sex = values.sex;

    if (Object.keys(changedValues).length === 0) {
      toast.info("No changes detected.");
      onOpenChange(false); // Close the dialog if no changes
      return;
    }

    setIsLoading(true);
    console.log(`Submitting update for user ${user.id}:`, changedValues);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(changedValues),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to update user.');
      }

      toast.success(result.message || 'User updated successfully!');
      onUserUpdated(result.user as UserData); // Pass the updated user data back, assert type
      onOpenChange(false); // Close the dialog
    } catch (error: unknown) {
      console.error('Error updating user:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render the dialog if no user is provided or dialog is not open
  if (!isOpen || !user) {
    return null; 
  }

  const isSessionLoading = sessionStatus === 'loading';

  const handleChangePassword = async () => {
    if (!user || !user.id) {
      toast.error("User context is missing. Cannot change password.");
      return;
    }
    if (!newPassword.trim()) {
      toast.error("New password cannot be empty.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters long.");
      return;
    }

    const currentToken = session?.accessToken;
    if (!currentToken) {
      toast.error("Authentication session is invalid. Please log in again.");
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to change password.');
      }

      toast.success(result.message || 'Password changed successfully!');
      setNewPassword(''); // Clear the password field
      // Optionally, close the dialog or refresh data if needed
      // onOpenChange(false); 
    } catch (error: unknown) {
      console.error('Error changing password:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* No DialogTrigger here, opened controlled by parent state */}
      <DialogContent className="sm:max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle>Edit User: {user?.name || user?.email}</DialogTitle>
          <DialogDescription>
            Modify the user details below. Click save to apply changes.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            {/* Row 1: Name and Email */}
            <div className="flex flex-row space-x-4">
              <div className="w-1/2">
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
              </div>
              <div className="w-1/2">
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
              </div>
            </div>

            {/* Row 2: Student Number and Contact Number */}
            <div className="flex flex-row space-x-4">
              <div className="w-1/2">
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
              </div>
              <div className="w-1/2">
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
              </div>
            </div>

            {/* Row 3: Role and Status */}
            <div className="flex flex-row space-x-4">
              <div className="w-1/2">
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isLoading || isSessionLoading}>
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
              </div>
              <div className="w-1/2">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isLoading || isSessionLoading}>
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
              </div>
            </div>

            {/* Sex Select (Optional) - Full width or can be paired if desired */}
            <FormField
              control={form.control}
              name="sex"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sex (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined} disabled={isLoading || isSessionLoading}>
                    <FormControl>
                      <SelectTrigger>
                         {/* Handle potential undefined value in placeholder */}
                        <SelectValue placeholder="Select sex (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {/* Add an explicit 'None' option? Maybe not needed if placeholder works */}
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* --- Admin Change Password Section --- */}
            <div className="space-y-2 pt-4 mt-6 border-t border-border">
              <h4 className="font-medium text-md text-foreground">Administrator: Change Password</h4>
              <p className="text-sm text-muted-foreground">
                Set a new password for {user?.name || user?.email}. The user will not be notified.
              </p>
              <FormItem>
                <FormLabel htmlFor="newPasswordAdmin">New Password</FormLabel>
                <FormControl>
                  <Input 
                    id="newPasswordAdmin"
                    type="password" 
                    placeholder="Enter new password (min 8 chars)" 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isLoading || isSessionLoading || isChangingPassword} 
                  />
                </FormControl>
                {/* Basic client-side validation message example (optional) */}
                {newPassword && newPassword.length > 0 && newPassword.length < 8 && (
                  <p className="text-sm text-destructive mt-1">Password must be at least 8 characters.</p>
                )}
              </FormItem>
              <Button 
                type="button" 
                onClick={handleChangePassword} 
                disabled={isLoading || isSessionLoading || isChangingPassword || !newPassword || newPassword.length < 8}
                className="mt-2"
              >
                {isChangingPassword ? <LoadingSpinner size="sm" /> : 'Set New Password'}
              </Button>
            </div>
            {/* --- End Admin Change Password Section --- */}
            
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading || isSessionLoading || isChangingPassword}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || isSessionLoading || isChangingPassword || !form.formState.isDirty}>
                {isLoading ? <LoadingSpinner size="sm" /> : 'Save User Details'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 