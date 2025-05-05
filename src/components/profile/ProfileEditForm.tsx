'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProfileUpdateSchema, ProfileUpdateInput } from '@/lib/schemas';
import { User } from '@prisma/client';
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

// Define a type for the subset of User data needed by the form
// Explicitly type sex here
type UserProfileData = Pick<User, 'name' | 'studentNumber' | 'contactNumber'> & { sex: 'Male' | 'Female' | null };

interface ProfileEditFormProps {
  userProfile: UserProfileData | null; // Use the more specific type
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateSuccess: (updatedProfile: Partial<UserProfileData>) => void;
}

export default function ProfileEditForm({ 
    userProfile, 
    isOpen, 
    onOpenChange, 
    onUpdateSuccess 
}: ProfileEditFormProps) {
    const [isLoading, setIsLoading] = useState(false);

    // Helper to ensure sex value is valid or undefined
    const getValidSex = (sexValue: string | null | undefined): 'Male' | 'Female' | undefined => {
        if (sexValue === 'Male' || sexValue === 'Female') {
            return sexValue;
        }
        return undefined;
    };

    const form = useForm<ProfileUpdateInput>({
        resolver: zodResolver(ProfileUpdateSchema),
        // Use helper function for default sex value
        defaultValues: {
            name: userProfile?.name || "",
            studentNumber: userProfile?.studentNumber || undefined,
            contactNumber: userProfile?.contactNumber || undefined,
            sex: getValidSex(userProfile?.sex),
        },
    });

    // Reset form when userProfile changes
    React.useEffect(() => {
        if (userProfile) {
            form.reset({
                name: userProfile.name || "",
                studentNumber: userProfile.studentNumber || undefined,
                contactNumber: userProfile.contactNumber || undefined,
                // Use helper function for reset sex value
                sex: getValidSex(userProfile.sex),
            });
        }
    }, [userProfile, form]);

    async function onSubmit(values: ProfileUpdateInput) {
        setIsLoading(true);
        console.log("Updating profile with:", values);

        // Filter out undefined values before sending
        const dataToSend = Object.fromEntries(
            Object.entries(values).filter(([_, v]) => v !== undefined && v !== '') // Only send defined, non-empty values
        );
        
        if (Object.keys(dataToSend).length === 0) {
            toast.info("No changes detected to submit.");
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/users/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSend),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Failed to update profile.');
            }

            toast.success('Profile updated successfully!');
            onUpdateSuccess(result); // Pass updated subset back to parent
            onOpenChange(false); // Close dialog

        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
            toast.error(`Update failed: ${message}`);
            console.error("Profile Update Error:", err);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Profile</DialogTitle>
                    <DialogDescription>
                        Update your personal information. Email cannot be changed.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Full Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Your full name" {...field} />
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
                                    <FormLabel>Student Number</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Your student number" {...field} value={field.value ?? ''} />
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
                                    <FormLabel>Contact Number</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Your contact number" {...field} value={field.value ?? ''} />
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
                                <FormLabel>Sex (Optional)</FormLabel>
                                {/* Pass the validated/typed value to the Select */}
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}> 
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select your sex" />
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
                        <DialogFooter className="pt-4">
                            <DialogClose asChild>
                                <Button type="button" variant="outline" disabled={isLoading}>
                                Cancel
                                </Button>
                            </DialogClose>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
} 