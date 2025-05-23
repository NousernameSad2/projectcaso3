'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useSession, SessionContextValue } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { UserRole } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Define a basic FacultyUser interface locally - Align with API response
interface FacultyUser {
  id: string;
  name: string | null; // Use 'name' field as returned by API
  email?: string | null; // Include email for display/search uniqueness if needed
}

// Define local types for session and user to avoid `as any`
interface SessionUser {
  id?: string;
  name?: string | null; // Added name
  email?: string | null; // Added email
  role?: UserRole | string; 
  // Add other relevant user fields if accessed from session?.user
}

// Correctly type AugmentedSessionData by picking and overriding from SessionContextValue
interface AugmentedSessionData extends Omit<SessionContextValue, 'data'> { // Omit original data
  data: { // Redefine data structure
    user?: SessionUser;
    accessToken?: string;
  } | null;
  // status and update will be inherited from SessionContextValue
}

// Define the schema for class updates
const ClassUpdateSchema = z.object({
  courseCode: z
    .string()
    .min(1, 'Course code is required.')
    .regex(/^[A-Z0-9\s]+$/, 'Course code must be alphanumeric.'),
  section: z
    .string()
    .min(1, 'Section is required.')
    .regex(/^[A-Za-z0-9]+$/, 'Section must be alphanumeric.'),
  semester: z.enum(['FIRST', 'SECOND', 'SUMMER'], {
    errorMap: () => ({ message: 'Invalid semester value.' }),
  }),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/, { message: "Must be in YYYY-YYYY format (e.g., 2023-2024)." }),
  ficId: z.string().optional(), // Made ficId optional in schema again, backend will enforce for Staff
  isActive: z.boolean(),
  schedule: z.string().min(1, { message: "Class schedule is required." }),
  venue: z.string().optional(),
});

type ClassUpdateInput = z.infer<typeof ClassUpdateSchema>;

interface ClassData {
  id: string;
  courseCode: string;
  section: string;
  semester: 'FIRST' | 'SECOND' | 'SUMMER';
  academicYear: string;
  ficId?: string | null;
  facultyInCharge?: {
    id: string;
    name: string | null;
    email?: string | null;
  } | null;
  isActive: boolean;
  schedule?: string | null;
  venue?: string | null;
}

interface UpdatedClassData {
  courseCode?: string;
  section?: string;
  semester?: 'FIRST' | 'SECOND' | 'SUMMER';
  academicYear?: string;
  ficId?: string | null;
  isActive?: boolean;
  schedule?: string;
  venue?: string;
}

interface EditClassDialogProps {
  classData: ClassData | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onClassUpdated: () => void; // Callback after successful update
}

export function EditClassDialog({
  classData,
  isOpen,
  onOpenChange,
  onClassUpdated,
}: EditClassDialogProps) {
  const { data: sessionData } = useSession() as AugmentedSessionData;
  const session = sessionData;
  const user = session?.user;
  const isStaff = user?.role === UserRole.STAFF;
  const isFaculty = user?.role === UserRole.FACULTY;
  const [facultyUsers, setFacultyUsers] = useState<FacultyUser[]>([]);
  const [isFetchingFaculty, setIsFetchingFaculty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const token = session?.accessToken;

  const form = useForm<ClassUpdateInput>({
    resolver: zodResolver(ClassUpdateSchema),
    defaultValues: {
      courseCode: '',
      section: '',
      semester: 'FIRST',
      academicYear: '',
      ficId: '',
      isActive: true,
      schedule: '',
      venue: '',
    },
  });

  useEffect(() => {
    if (classData) {
      let currentFicId = classData.ficId || undefined;
      // If the current user is faculty and is the FIC of this class, ensure their ID is set.
      if (isFaculty && user?.id === classData.ficId) {
        currentFicId = user.id;
      }

      form.reset({
        courseCode: classData.courseCode,
        section: classData.section,
        semester: classData.semester ?? 'FIRST',
        academicYear: classData.academicYear,
        ficId: currentFicId,
        isActive: classData.isActive,
        schedule: classData.schedule || '',
        venue: classData.venue || '',
      });
    } else {
      form.reset({
        courseCode: '',
        section: '',
        semester: 'FIRST',
        academicYear: '',
        ficId: undefined, // Reset to undefined
        isActive: true,
        schedule: '',
        venue: '',
      });
    }
  }, [classData, form, isFaculty, user?.id]); // Added isFaculty and user.id

  useEffect(() => {
    async function fetchFaculty() {
      if (!isStaff || !isOpen) return;
      setIsFetchingFaculty(true);
      try {
        if (!token) {
          throw new Error('Authentication token not found.');
        }
        const response = await fetch('/api/users?role=FACULTY', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch faculty: ${response.statusText}`);
        }
        const data: FacultyUser[] = await response.json(); // Assume API returns FacultyUser[]
        setFacultyUsers(data);
      } catch (error) {
        console.error('Error fetching faculty:', error);
        toast.error('Could not fetch faculty list. Please try again later.');
      } finally {
        setIsFetchingFaculty(false);
      }
    }

    fetchFaculty();
  }, [isStaff, isOpen, session, token]);

  async function onSubmit(values: ClassUpdateInput) {
    if (!classData) return;

    if (!token) {
      toast.error('Authentication Error: You must be logged in to update a class.');
      return;
    }

    const submissionValues = { ...values };

    if (isStaff) {
      if (!submissionValues.ficId) {
        form.setError("ficId", { message: "Faculty-in-Charge is required for Staff.", type: "manual" });
        toast.error("Faculty-in-Charge must be selected by Staff.");
        return;
      }
    } else if (isFaculty && user?.id) {
      // If faculty, FIC should be their own ID if the class is assigned to them, or if it's becoming assigned to them.
      // They cannot change FIC to another faculty or unassign if they are the current FIC.
      if (classData.ficId && classData.ficId !== user.id) {
        // Trying to edit a class where they are not the FIC
        toast.error("Faculty can only modify classes where they are the Faculty-in-Charge.");
        submissionValues.ficId = classData.ficId;
      } else {
        submissionValues.ficId = user.id;
      }
       // Faculty cannot change isActive status directly
      if (values.isActive !== classData.isActive) {
        toast.info("Faculty cannot change the active status. This change will be ignored.");
        submissionValues.isActive = classData.isActive; // Revert to original
      }
    }

    // Determine changed values by comparing submissionValues with classData
    const changedValues: UpdatedClassData = {};
    if (submissionValues.courseCode !== classData.courseCode) changedValues.courseCode = submissionValues.courseCode;
    if (submissionValues.section !== classData.section) changedValues.section = submissionValues.section;
    if (submissionValues.semester !== classData.semester) changedValues.semester = submissionValues.semester;
    if (submissionValues.academicYear !== classData.academicYear) changedValues.academicYear = submissionValues.academicYear;
    if (submissionValues.ficId !== classData.ficId) changedValues.ficId = submissionValues.ficId || null; // Allow unsetting to null
    if (submissionValues.isActive !== classData.isActive && isStaff) changedValues.isActive = submissionValues.isActive; // Only staff can change
    if (submissionValues.schedule !== classData.schedule) changedValues.schedule = submissionValues.schedule;
    if (submissionValues.venue !== classData.venue) changedValues.venue = submissionValues.venue;

    if (Object.keys(changedValues).length === 0) {
      toast.info('No changes were made.');
      return;
    }

    console.log(`Updating class ${classData.id} with:`, changedValues);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/classes/${classData.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(submissionValues),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("Update failed with status:", response.status, "and result:", result);
        throw new Error(result.message || 'Failed to update class.');
      }

      toast.success(result.message || 'Class updated successfully!');
      onClassUpdated(); // Call the callback
      onOpenChange(false); // Close dialog on success
    } catch (error: unknown) {
      console.error('Error updating class:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      toast.error(`Error: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!classData) return null; // Don't render if no class data

  const handleCloseDialog = (open: boolean) => {
    if (!open) {
      form.reset(); // Reset form when dialog is closed
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCloseDialog}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Class</DialogTitle>
          <DialogDescription>
            Make changes to the class details here. Click save when you&apos;re
            done.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="courseCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Course Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., CS101" {...field} />
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
                    <Input placeholder="e.g., A" {...field} />
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
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a semester" />
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
            <FormField
              control={form.control}
              name="academicYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Academic Year</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 2023-2024" {...field} />
                  </FormControl>
                  <FormDescription>Format: YYYY-YYYY</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* FIC Field - Conditional rendering/disabling */}
            {(isStaff || (isFaculty && user?.id === classData.ficId) || (isFaculty && !classData.ficId)) && (
              <FormField
                control={form.control}
                name="ficId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Faculty-in-Charge *</FormLabel>
                    {(isStaff) ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              className={cn(
                                'w-full justify-between',
                                !field.value && 'text-muted-foreground'
                              )}
                              disabled={isFetchingFaculty || isSubmitting}
                            >
                              {field.value
                                ? facultyUsers.find((faculty) => faculty.id === field.value)?.name ?? 'Select Faculty'
                                : 'Select Faculty'}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                          <Command>
                            <CommandInput placeholder="Search faculty..." />
                            <CommandEmpty>No faculty found.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="NONE" // For unassigning by Staff
                                onSelect={() => {
                                  form.setValue('ficId', undefined, { shouldValidate: true, shouldDirty: true });
                                }}
                              >
                                <Check className={cn('mr-2 h-4 w-4',!field.value ? 'opacity-100' : 'opacity-0' )}/>
                                None
                              </CommandItem>
                              {facultyUsers.map((faculty) => (
                                <CommandItem
                                  value={faculty.name || faculty.id}
                                  key={faculty.id}
                                  onSelect={() => {
                                    form.setValue('ficId', faculty.id, {shouldValidate: true, shouldDirty: true });
                                  }}
                                >
                                  <Check className={cn('mr-2 h-4 w-4',faculty.id === field.value? 'opacity-100': 'opacity-0' )}/>
                                  {faculty.name} {faculty.email ? `(${faculty.email})` : ''}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    ) : (isFaculty && user?.id) ? (
                       // Faculty sees their name, disabled, if they are the FIC or it's being assigned to them
                        <Input
                            value={user.name || user.email || ''} // Ensure fallback to empty string if both are null/undefined
                            disabled
                        />
                    ) : null } 
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {/* Display for Faculty if they are NOT the FIC (and not staff) */}
            {(isFaculty && classData.ficId && user?.id !== classData.ficId) && (
                 <FormItem>
                    <FormLabel>Faculty-in-Charge *</FormLabel>
                    <Input
                        value={classData.facultyInCharge?.name || 'Assigned'}
                        disabled
                    />
                </FormItem>
            )}

            <FormField
              control={form.control}
              name="schedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class Schedule *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., MWF 10:00-11:30" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="venue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Venue (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Rm 301, Engg Bldg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                  <div className="space-y-0.5">
                    <FormLabel>Active Status</FormLabel>
                    {/* <FormDescription>
                      Control if the class is currently active.
                    </FormDescription> */}
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isStaff} // Only staff can change active status
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCloseDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!form.formState.isDirty || isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
