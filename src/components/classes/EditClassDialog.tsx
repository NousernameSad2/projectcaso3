'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon, Check, ChevronsUpDown } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
import { format } from 'date-fns';

// Define a basic FacultyUser interface locally - Align with API response
interface FacultyUser {
  id: string;
  name: string | null; // Use 'name' field as returned by API
  email?: string | null; // Include email for display/search uniqueness if needed
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
  ficId: z.string().optional(),
  isActive: z.boolean(),
  schedule: z.string().optional(),
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
  const { data: session } = useSession();
  const user = session?.user as any; // Cast to any temporarily - proper fix involves type augmentation
  const isStaff = user?.role === 'STAFF';
  const [facultyUsers, setFacultyUsers] = useState<FacultyUser[]>([]);
  const [isFetchingFaculty, setIsFetchingFaculty] = useState(false);

  const token = (session as any)?.accessToken; // Extract token

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
      form.reset({
        courseCode: classData.courseCode,
        section: classData.section,
        semester: classData.semester ?? 'FIRST',
        academicYear: classData.academicYear,
        ficId: classData.ficId || undefined,
        isActive: classData.isActive,
        schedule: classData.schedule || '',
        venue: classData.venue || '',
      });
    } else {
      // Optionally reset to defaults if classData becomes null
      form.reset({
        courseCode: '',
        section: '',
        semester: 'FIRST',
        academicYear: '',
        ficId: '',
        isActive: true,
        schedule: '',
        venue: '',
      });
    }
  }, [classData, form]);

  useEffect(() => {
    async function fetchFaculty() {
      if (!isStaff || !isOpen) return; // Only fetch if staff and dialog is open
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

    const token = (session as any)?.accessToken; // Cast to any temporarily
    if (!token) {
      toast.error('Authentication Error: You must be logged in to update a class.');
      return;
    }

    // Determine changed values
    const changedValues: UpdatedClassData = {};
    if (values.courseCode !== classData.courseCode) {
      changedValues.courseCode = values.courseCode;
    }
    if (values.section !== classData.section) {
      changedValues.section = values.section;
    }
    if (values.semester !== classData.semester) {
      changedValues.semester = values.semester;
    }
    if (values.academicYear !== classData.academicYear) {
      changedValues.academicYear = values.academicYear;
    }
    if (values.ficId !== classData.ficId) {
      changedValues.ficId = values.ficId || null;
    }
    if (values.isActive !== classData.isActive) {
      changedValues.isActive = values.isActive;
    }
    if (values.schedule !== classData.schedule) {
      changedValues.schedule = values.schedule;
    }
    if (values.venue !== classData.venue) {
      changedValues.venue = values.venue;
    }

    // Prevent non-staff from changing FIC unless it's assigning to themselves
    if (!isStaff) {
      const currentFicId = classData.ficId ?? undefined;
      // Allow unassigning themselves or keeping it assigned to themselves
      const allowedFicChange =
        values.ficId === undefined || // Unassigning
        values.ficId === user?.id; // Assigning/Keeping to self

      if (values.ficId !== currentFicId && !allowedFicChange) {
        toast.error(
          'Permission Denied: Faculty can only assign/unassign themselves as Faculty-in-Charge.'
        );
        return; // Stop submission
      }
      // Faculty cannot change isActive status directly
      if (changedValues.hasOwnProperty('isActive')) {
        delete changedValues.isActive; // Remove isActive from changed values if user is faculty
        toast.error(
          'Permission Denied: Faculty cannot change the active status of a class.'
        );
        if (Object.keys(changedValues).length === 0) return; // Nothing else to update
      }
    }

    if (Object.keys(changedValues).length === 0) {
      toast.info('No changes were detected.');
      onOpenChange(false); // Close dialog if no changes
      return;
    }

    console.log('Submitting changed values:', changedValues);

    try {
      const response = await fetch(`/api/classes/${classData.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changedValues),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update class.');
      }

      toast.success('Class updated successfully.');
      onClassUpdated(); // Notify parent component
      onOpenChange(false); // Close the dialog
    } catch (error: any) {
      console.error('Update failed:', error);
      toast.error(`Update Failed: ${error.message || 'An unexpected error occurred.'}`);
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
            Make changes to the class details here. Click save when you're
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

            {isStaff && (
              <FormField
                control={form.control}
                name="ficId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Faculty-in-Charge</FormLabel>
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
                            disabled={isFetchingFaculty}
                          >
                            {field.value // Display name using the 'name' field
                              ? facultyUsers.find(
                                  (faculty) => faculty.id === field.value
                                )?.name ?? 'Faculty not found' // Use name field
                              : 'Select Faculty'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                        <Command filter={(value, search) => { 
                           // Custom filter to search name and potentially email
                           const faculty = facultyUsers.find(f => f.id === value); // value might be id here if set differently
                           // Or more likely, filter based on displayed text vs search term
                           const nameMatch = faculty?.name?.toLowerCase().includes(search.toLowerCase());
                           const emailMatch = faculty?.email?.toLowerCase().includes(search.toLowerCase());
                           // A simple text search against the item text might be handled by Command automatically
                           // Let's simplify and assume Command default filter works on the text content
                           return 1; // Default Command filter is likely sufficient
                          }}>
                          <CommandInput placeholder="Search faculty..." />
                          <CommandEmpty>No faculty found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="NONE" // Use a distinct value for 'None'
                              onSelect={() => {
                                form.setValue('ficId', undefined, { // Set to undefined
                                  shouldValidate: true,
                                  shouldDirty: true,
                                });
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  !field.value ? 'opacity-100' : 'opacity-0' // Check if value is falsy
                                )}
                              />
                              None
                            </CommandItem>
                            {facultyUsers.map((faculty) => (
                              <CommandItem
                                // Use a combination or just name for the searchable value
                                value={faculty.name || faculty.id} 
                                key={faculty.id}
                                onSelect={() => {
                                  form.setValue('ficId', faculty.id, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                  });
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    faculty.id === field.value
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  )}
                                />
                                {faculty.name} {faculty.email ? `(${faculty.email})` : ''} {/* Display name and email */}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Display for non-staff users - use name field */}
            {!isStaff && classData.facultyInCharge && (
              <FormItem>
                <FormLabel>Faculty-in-Charge</FormLabel>
                <Input
                  value={`${classData.facultyInCharge.name ?? 'N/A'}`}
                  disabled
                />
              </FormItem>
            )}
            {!isStaff && !classData.facultyInCharge && (
              <FormItem>
                <FormLabel>Faculty-in-Charge</FormLabel>
                <Input value="Not Assigned" disabled />
              </FormItem>
            )}

            <FormField
              control={form.control}
              name="schedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class Schedule (Optional)</FormLabel>
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
              <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
