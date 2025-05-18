'use client';

import React, { useState, useEffect } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PlusCircle } from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Update schema to use enum for semester and add academicYear
const ClassCreateSchema = z.object({
  courseCode: z.string().min(3, { message: "Course code must be at least 3 characters." }),
  section: z.string().min(1, { message: "Section is required." }),
  // Use enum for semester validation
  semester: z.enum(['FIRST', 'SECOND', 'SUMMER'], {
    errorMap: () => ({ message: 'Please select a valid semester.' }),
  }),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/, { message: "Must be in YYYY-YYYY format (e.g., 2023-2024)." }), // Added academic year
  // FIC is optional for FACULTY, required for STAFF
  ficId: z.string().optional(), 
  schedule: z.string().optional(),
  venue: z.string().optional(),
});

type ClassCreateInput = z.infer<typeof ClassCreateSchema>;

// Interface for faculty user data needed for the Select dropdown
interface FacultyUser {
  id: string;
  name: string | null;
  email: string | null;
}

// Define the type for the newly created class data returned by API
interface CreatedClassData {
  id: string;
  courseCode: string;
  section: string;
  semester: string; // Assuming semester is string, adjust if it's an enum value from server
  academicYear: string;
  ficId?: string | null;
  schedule?: string | null;
  venue?: string | null;
  isActive: boolean;
  createdAt: string; // Assuming ISO string date
  updatedAt: string; // Assuming ISO string date
  // Add other fields if returned and needed by parent
}

type AddClassDialogProps = {
  onClassAdded: (newClass: CreatedClassData) => void; // Typed newClass
};

export default function AddClassDialog({ onClassAdded }: AddClassDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [facultyList, setFacultyList] = useState<FacultyUser[]>([]);
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.accessToken;
  const user = session?.user;
  const userRole = user?.role; // Store role for easier access
  // Show FIC dropdown for STAFF or FACULTY
  const canSelectFIC = userRole === UserRole.STAFF || userRole === UserRole.FACULTY; 
  const isStaff = userRole === UserRole.STAFF; // Keep isStaff for submission logic

  // *** Logging - keep for now ***
  console.log("[AddClassDialog] Debug Info:");
  console.log("  - Session Status:", sessionStatus);
  console.log("  - User Object:", JSON.stringify(user)); // Log stringified user
  console.log("  - User Role:", userRole);
  console.log("  - Calculated isStaff:", isStaff);
  console.log("  - Can Select FIC:", canSelectFIC); // Add this log
  console.log("  - Faculty List Length:", facultyList.length);

  const form = useForm<ClassCreateInput>({
    resolver: zodResolver(ClassCreateSchema),
    defaultValues: {
      courseCode: '',
      section: '',
      semester: undefined, // Default to undefined for enum select
      academicYear: '', // Added default value
      ficId: '',
      schedule: '',
      venue: '',
    },
  });

  // Fetch faculty list when dialog opens if user is Staff or Faculty
  useEffect(() => {
    const fetchFaculty = async () => {
      // Fetch if dialog is open, user is authenticated, and role is STAFF or FACULTY
      if (isOpen && canSelectFIC && sessionStatus === 'authenticated' && token) {
        console.log("Fetching faculty using NextAuth token (User Role:", userRole, ")");
        try {
          const response = await fetch('/api/users?role=FACULTY', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw new Error('Failed to fetch faculty');
          const faculty: FacultyUser[] = await response.json();
          setFacultyList(faculty);
          console.log("Faculty found:", faculty.length);
        } catch (error) {
          console.error("Error fetching faculty:", error);
          toast.error("Could not load faculty list.");
        }
      }
    };
    fetchFaculty();
  }, [isOpen, canSelectFIC, sessionStatus, token, userRole]);

  const onSubmit: SubmitHandler<ClassCreateInput> = async (values) => {
    const currentToken = session?.accessToken;
    if (!currentToken) {
      toast.error('Authentication session is invalid. Please log in again.');
      return;
    }
    // If user is STAFF, FIC selection is mandatory
    if (isStaff && !values.ficId) { 
      toast.error('Faculty in Charge must be selected by Staff.');
      return;
    }

    setIsLoading(true);
    console.log('Submitting new class:', values);

    // If user is FACULTY and didn't select an FIC, ficId will be empty/undefined.
    // The backend should handle assigning the creator as FIC in this case.
    // If user is STAFF, ficId must be present (checked above).
    // If user is FACULTY and DID select an FIC, that value is sent.
    const payload = { ...values }; 

    try {
      const response = await fetch('/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to add class.');
      }

      toast.success(result.message || 'Class created successfully!');
      onClassAdded(result.class as CreatedClassData); // Assuming API returns { message: string, class: CreatedClassData }
      form.reset();
      setIsOpen(false);
    } catch (error: unknown) { // Changed to unknown
      console.error('Error adding class:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Create Class
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>Create New Class</DialogTitle>
          <DialogDescription>
            Enter the details for the new class.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="courseCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Course Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., DGE 101" {...field} disabled={isLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="section"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., A" {...field} disabled={isLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="semester"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Semester</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select semester..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="FIRST">First Semester</SelectItem>
                      <SelectItem value="SECOND">Second Semester</SelectItem>
                      <SelectItem value="SUMMER">Summer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Added Academic Year Field */}
            <FormField
              control={form.control}
              name="academicYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Academic Year</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 2023-2024" {...field} disabled={isLoading} />
                  </FormControl>
                  <FormDescription>Format: YYYY-YYYY</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Show FIC dropdown if user is STAFF or FACULTY */}
            {canSelectFIC && ( 
              <FormField
                control={form.control}
                name="ficId"
                render={({ field }) => (
                  <FormItem>
                    {/* Label adjustment based on role */}
                    <FormLabel>
                      Faculty in Charge (FIC) 
                      {isStaff ? ' (Required)' : ' (Optional - defaults to you if empty)'}
                    </FormLabel>
                    <Select 
                        onValueChange={field.onChange} 
                        value={field.value || ''} // Ensure value is controlled, handle undefined
                        disabled={isLoading || sessionStatus === 'loading' || facultyList.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={sessionStatus === 'loading' ? "Checking auth..." : "Select Faculty"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {facultyList.length === 0 && <SelectItem value="loading" disabled>Loading faculty...</SelectItem>}
                        {/* Add an empty option for FACULTY if they want to default to themselves? */}
                        {/* Or just let them submit empty. Let's keep it simple for now. */}
                        {facultyList.map((faculty) => (
                          <SelectItem key={faculty.id} value={faculty.id}>
                            {faculty.name || faculty.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* <<< Add Schedule Field >>> */}
            <FormField
              control={form.control}
              name="schedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class Schedule (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., MWF 10:00-11:30 / TTh 1:00-2:30" {...field} />
                  </FormControl>
                  <FormDescription>
                    Enter the meeting days and times.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* <<< Add Venue Field >>> */}
            <FormField
              control={form.control}
              name="venue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Venue (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Rm 301, Engg Bldg / Online" {...field} />
                  </FormControl>
                  <FormDescription>
                    Enter the location where the class meets.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || sessionStatus === 'loading'}>
                {isLoading ? <LoadingSpinner size="sm" /> : 'Create Class'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 