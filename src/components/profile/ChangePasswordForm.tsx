'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, ChangePasswordInput } from '@/lib/schemas'; // Assuming schemas exist
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface ChangePasswordFormProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChangePasswordForm({ isOpen, onOpenChange }: ChangePasswordFormProps) {
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm<ChangePasswordInput>({
        resolver: zodResolver(ChangePasswordSchema),
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    async function onSubmit(values: ChangePasswordInput) {
        setIsLoading(true);
        console.log("Submitting password change request...");

        let response: Response | null = null; // Define response outside try block

        try {
            response = await fetch('/api/users/change-password', { // Target new API route
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: values.currentPassword,
                    newPassword: values.newPassword
                    // No need to send confirmPassword, validation is done client/server-side
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                 // Handle specific errors like incorrect current password
                if (response.status === 401) {
                    form.setError("currentPassword", { type: "manual", message: result.message || "Incorrect current password." });
                    throw new Error(result.message || 'Authentication failed.'); // Throw to prevent success toast
                } else if (response.status === 400 && result.errors) {
                     // Handle validation errors from server (e.g., complexity rules)
                    if (result.errors.newPassword) {
                         form.setError("newPassword", { type: "manual", message: result.errors.newPassword.join(', ') });
                    }
                     throw new Error(result.message || 'Validation failed.');
                } else {
                    throw new Error(result.message || 'Failed to change password.');
                }
            }

            toast.success('Password changed successfully!');
            onOpenChange(false); // Close dialog
            form.reset(); // Reset form fields

        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
             // Avoid showing generic toast if specific errors were set
            if (response && response.status !== 401 && !(response.status === 400 && form.formState.errors)) { // Check response status and if errors were set manually
                toast.error(`Password change failed: ${message}`);
            }
            console.error("Password Change Error:", err);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) form.reset(); // Reset form if dialog is closed
            onOpenChange(open);
        }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Change Password</DialogTitle>
                    <DialogDescription>
                        Enter your current password and choose a new one.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="currentPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Current Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="Your current password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="newPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="Choose a new password" {...field} />
                                    </FormControl>
                                     <FormDescription>
                                        Must be at least 8 characters long.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Confirm New Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="Confirm your new password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter className="pt-4">
                            <DialogClose asChild>
                                <Button type="button" variant="outline" disabled={isLoading}>
                                Cancel
                                </Button>
                            </DialogClose>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                                Change Password
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
} 