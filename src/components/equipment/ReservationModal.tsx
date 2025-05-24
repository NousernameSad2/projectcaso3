'use client';

import React, { useState, useEffect } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { /* ReservationBaseSchema, ReservationInput*/ } from "@/lib/schemas"; // Removed ReservationInput
import { Equipment, Class, User, UserRole } from '@prisma/client'; // Added UserRole
import { toast } from "sonner"; // Import toast
import { useSession } from 'next-auth/react'; // Import useSession
import { format, parseISO } from 'date-fns'; // For formatting date/time and parseISO
import { z } from 'zod';

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose, // Import DialogClose
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area"; // Import ScrollArea
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"; // Added Select
import { Loader2 } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Define a basic type for the fetched class data
// Changed to type aliases
type EnrolledClass = Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'>;

type Classmate = Pick<User, 'id' | 'name'>;

// Schema for the form in this modal
const FormSchemaForModal = z.object({
  equipmentIds: z.array(z.string().min(1)).min(1, { message: "At least one equipment item must be selected." }),
  requestedStartTime: z.coerce.date({ 
      required_error: "Start date and time are required.",
      invalid_type_error: "Invalid start date/time format."
  }).refine(date => {
    const hours = date.getHours();
    return hours >= 6 && hours < 20;
  }, { message: "Reservation must be between 6:00 AM and 8:00 PM." }),
  requestedEndTime: z.coerce.date({ 
      required_error: "End date and time are required.",
      invalid_type_error: "Invalid end date/time format."
  }).refine(date => {
    const hours = date.getHours();
    return hours >= 6 && hours < 20;
  }, { message: "Reservation must be between 6:00 AM and 8:00 PM." }),
  classId: z.string().optional(), // Made classId optional at schema level
}).refine(
  (data) => { // data should now be correctly typed based on the z.object above
    if (!data.requestedStartTime || !data.requestedEndTime) {
      return true;
    }
    return data.requestedEndTime > data.requestedStartTime;
  }, 
  {
    message: "End time must be after start time.",
    path: ["requestedEndTime"], 
  }
);
type FormValuesForModal = z.infer<typeof FormSchemaForModal>;

interface ReservationModalProps {
  equipmentToReserve: Equipment[]; // Accept array of equipment
  triggerButton: React.ReactNode; // Allow custom trigger button
  onReservationSuccess?: () => void; // Optional callback on success
}

export default function ReservationModal({
  equipmentToReserve,
  triggerButton,
  onReservationSuccess,
}: ReservationModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { data: session, status: sessionStatus } = useSession(); // Use next-auth session
  const [enrolledClasses, setEnrolledClasses] = useState<EnrolledClass[]>([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [isLoadingClassmates, setIsLoadingClassmates] = useState(false);
  const [selectedClassmateIds, setSelectedClassmateIds] = useState<Set<string>>(new Set());
  const [isClassmatePopoverOpen, setIsClassmatePopoverOpen] = useState(false);

  const form = useForm<FormValuesForModal>({ // Use FormValuesForModal
    resolver: zodResolver(FormSchemaForModal), // Use FormSchemaForModal
    defaultValues: {
      equipmentIds: equipmentToReserve.map(eq => eq.id),
      requestedStartTime: undefined,
      requestedEndTime: undefined,
      classId: "",
      // groupMates is not part of FormValuesForModal, so no default needed here
    },
  });

  // Reset form and dropdown states
  React.useEffect(() => {
    if (isOpen) {
      form.reset({
        equipmentIds: equipmentToReserve.map(eq => eq.id),
        requestedStartTime: undefined,
        requestedEndTime: undefined,
        classId: "",
      });
      setSelectedClassId("");
      setSelectedClassmateIds(new Set());
      setEnrolledClasses([]);
      setClassmates([]);
      setClassError(null);
    }
  }, [isOpen, equipmentToReserve, form]);

  // Fetch enrolled classes
  useEffect(() => {
    const fetchClasses = async () => {
      if (isOpen && sessionStatus === 'authenticated') { // Allow for staff/faculty too now
        setIsLoadingClasses(true);
        setClassError(null);
        try {
          // Use the correct API endpoint
          const response = await fetch('/api/user/classes'); 
          if (!response.ok) {
             // ... error handling ...
          }
          const data = await response.json();
          setEnrolledClasses(data as EnrolledClass[]);
        } catch { /* Removed _error */ }
        finally { setIsLoadingClasses(false); }
      }
    };
    fetchClasses();
  }, [isOpen, sessionStatus]);

  // Fetch classmates when selectedClassId changes
  useEffect(() => {
    const fetchClassmates = async () => {
      if (!selectedClassId) {
        setClassmates([]);
        setSelectedClassmateIds(new Set()); // Clear selections if class changes
        return;
      }
      setIsLoadingClassmates(true);
      try {
        const response = await fetch(`/api/classes/${selectedClassId}/students`);
        if (!response.ok) {
          throw new Error('Failed to fetch classmates.');
        }
        const data = await response.json();
        // Filter out the logged-in user from the list
        const filteredData = (data as Classmate[]).filter(cm => cm.id !== session?.user?.id);
        setClassmates(filteredData);
        setSelectedClassmateIds(new Set()); // Clear selections when classmates reload
      } catch { /* Removed _error */ }
      finally { setIsLoadingClassmates(false); }
    };
    fetchClassmates();
  }, [selectedClassId, session?.user?.id]); // Depend on selectedClassId and userId

  // Handle form submission
  async function onSubmit(values: FormValuesForModal) { // Use FormValuesForModal
    if (sessionStatus !== 'authenticated' || !session?.user?.id) {
        toast.error("You must be logged in to make a reservation.");
        return;
    }
    const userRole = session.user.role;

    // Validate classId is selected if required (i.e., user is REGULAR)
    if (userRole === UserRole.REGULAR && (!values.classId || values.classId.trim() === "")) {
        form.setError("classId", { type: "manual", message: "Please select your class." });
        // toast.error("Please select your class before submitting."); // setError will show message
        return;
    }

    setIsLoading(true);
    // Construct payload including selected classmate IDs
    const payload = {
        equipmentIds: values.equipmentIds,
        requestedStartTime: values.requestedStartTime,
        requestedEndTime: values.requestedEndTime,
        classId: (userRole === UserRole.REGULAR || (values.classId && values.classId.trim() !== "")) ? values.classId : null, // Send null if faculty/staff and no class selected
        groupMateIds: Array.from(selectedClassmateIds), 
    };

    try {
      console.log("Attempting API Call to /api/borrows with payload:", JSON.stringify(payload));
      const response = await fetch('/api/borrows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (!response.ok) {
        const apiErrorMessage = responseData?.message || responseData?.errors || 'Failed to create reservation. Status: ' + response.status;
        let detailedError = apiErrorMessage;
        if (responseData?.errors && typeof responseData.errors === 'object') {
            detailedError = Object.entries(responseData.errors)
                .map(([field, messages]) => `${field}: ${(Array.isArray(messages) ? messages.join(', ') : messages)}`)
                .join('; ');
        }
        throw new Error(typeof detailedError === 'string' ? detailedError : 'Failed to create reservation.');
      }

      console.log("Reservation submitted successfully:", responseData);
      toast.success("Reservation request submitted!");
      setIsOpen(false);
      onReservationSuccess?.();

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(`Submission Error: ${errorMessage}`);
      console.error("Reservation Submission Error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  // Get current DateTime for min attribute on inputs (YYYY-MM-DDTHH:mm)
  const nowDateTimeLocal = format(new Date(), "yyyy-MM-dd'T'HH:mm");
  // Get start time value for min attribute on end time input
  const startTimeValue = form.watch('requestedStartTime');
  const minEndTime = startTimeValue ? format(startTimeValue, "yyyy-MM-dd'T'HH:mm") : nowDateTimeLocal;

  // Multi-select combobox logic
  const toggleClassmate = (classmateId: string) => {
    setSelectedClassmateIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(classmateId)) {
        newSet.delete(classmateId);
      } else {
        newSet.add(classmateId);
      }
      return newSet;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {triggerButton}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Request Reservation</DialogTitle>
          <DialogDescription>
            Select the desired reservation start and end date/time.
          </DialogDescription>
          {/* List selected equipment */}
          <ScrollArea className="max-h-[150px] my-2 rounded-md border p-3 text-sm">
              <ul>
                  {equipmentToReserve.map(eq => (
                      <li key={eq.id} className="text-muted-foreground">{eq.name} {eq.equipmentId ? `(${eq.equipmentId})` : ''}</li>
                  ))}
              </ul>
          </ScrollArea>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Form {...form}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Requested Start Time */}
               <FormField
               control={form.control}
                name="requestedStartTime"
               render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date & Time</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        value={field.value ? format(field.value, "yyyy-MM-dd'T'HH:mm") : ''}
                        onChange={(e) => field.onChange(e.target.value ? parseISO(e.target.value) : null)}
                        min={nowDateTimeLocal}
                        className="block w-full"
                        disabled={isLoading}
                   />
                    </FormControl>
                   <FormMessage />
                   </FormItem>
               )}
               />

              {/* Requested End Time */}
               <FormField
               control={form.control}
                name="requestedEndTime"
               render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date & Time</FormLabel>
                     <FormControl>
                      <Input
                        type="datetime-local"
                        value={field.value ? format(field.value, "yyyy-MM-dd'T'HH:mm") : ''}
                        onChange={(e) => field.onChange(e.target.value ? parseISO(e.target.value) : null)}
                        min={minEndTime}
                        className="block w-full"
                        disabled={isLoading || !startTimeValue}
                   />
                     </FormControl>
                   <FormMessage />
                   </FormItem>
               )}
               />
           </div>

            {/* Class Selection Dropdown */}
            <FormField
              control={form.control}
              name="classId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Class 
                    {session?.user?.role === UserRole.REGULAR && <span className="text-destructive">*</span>}
                    {session?.user?.role !== UserRole.REGULAR && " (Optional for Faculty/Staff)"}
                  </FormLabel>
                      <Select 
                    onValueChange={(value) => {
                        field.onChange(value === "NONE_OR_GENERAL_USE" ? "" : value); // Handle general use if added
                        setSelectedClassId(value === "NONE_OR_GENERAL_USE" ? "" : value); 
                    }}
                        value={field.value}
                    disabled={isLoadingClasses || (enrolledClasses.length === 0 && session?.user?.role === UserRole.REGULAR)}
                      >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingClasses ? "Loading classes..." : (session?.user?.role !== UserRole.REGULAR ? "Select class (Optional)" : "Select your class...")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {isLoadingClasses ? (
                          <SelectItem value="loading" disabled>Loading...</SelectItem>
                      ) : enrolledClasses.length > 0 ? (
                        <>
                          {session?.user?.role !== UserRole.REGULAR && (
                            <SelectItem value="NONE_OR_GENERAL_USE">
                              General Use / No Class Associated
                            </SelectItem>
                          )}
                          {enrolledClasses.map((cls) => (
                            <SelectItem key={cls.id} value={cls.id}>
                              {`${cls.courseCode} ${cls.section} (${cls.semester})`}
                            </SelectItem>
                          ))}
                        </>
                      ) : (
                          session?.user?.role !== UserRole.REGULAR ? (
                             <SelectItem value="NONE_OR_GENERAL_USE">
                                General Use / No Class Associated
                             </SelectItem>
                          ) : (
                            <SelectItem value="no-classes" disabled>
                              {classError || "No enrolled classes found. Please enroll in a class first or contact support."}
                            </SelectItem>
                          )
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Group Mates Multi-Select Combobox */}
               <FormItem>
                 <FormLabel>Group Mates (Optional)</FormLabel>
                 <Popover open={isClassmatePopoverOpen} onOpenChange={setIsClassmatePopoverOpen}>
                    <PopoverTrigger asChild>
                 <FormControl>
                             <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isClassmatePopoverOpen}
                                className={`w-full justify-between h-auto min-h-10 ${selectedClassmateIds.size === 0 && "text-muted-foreground"}`}
                                disabled={!selectedClassId || isLoadingClassmates || classmates.length === 0}
                             >
                                 <span className="flex flex-wrap gap-1">
                                    {selectedClassmateIds.size === 0 && (isLoadingClassmates ? "Loading..." : (classmates.length === 0 ? "No classmates in selected class" : "Select classmates..."))}
                                    {Array.from(selectedClassmateIds).map(id => (
                                        <Badge
                                            variant="secondary"
                                            key={id}
                                            className="mr-1 mb-1"
                                            onClick={(e) => { 
                                                e.stopPropagation(); // Prevent popover close
                                                toggleClassmate(id);
                                            }}
                                        >
                                            {classmates.find(cm => cm.id === id)?.name}
                                            <X className="ml-1 h-3 w-3 cursor-pointer" />
                                        </Badge>
                                    ))}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                             </Button>
                 </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
                         <Command>
                             <CommandInput placeholder="Search classmates..." />
                             <CommandList>
                                 <CommandEmpty>No classmates found.</CommandEmpty>
                                 <CommandGroup>
                                     {classmates.map((classmate) => (
                                         <CommandItem
                                            key={classmate.id}
                                            value={classmate.name ?? classmate.id} // Use name for search
                                            onSelect={() => {
                                                toggleClassmate(classmate.id);
                                                // Optionally close popover on select, or keep open for multi
                                                // setIsClassmatePopoverOpen(false);
                                            }}
                                        >
                                            <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    selectedClassmateIds.has(classmate.id) ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            {classmate.name}
                                         </CommandItem>
                                     ))}
                                 </CommandGroup>
                             </CommandList>
                         </Command>
                    </PopoverContent>
                </Popover>
                <FormDescription>
                    Select classmates you are borrowing with.
                </FormDescription>
                 <FormMessage />
               </FormItem>
          </Form>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isLoading}>
                  Cancel
                </Button>
             </DialogClose>
             <Button 
              type="submit" 
              disabled={
                isLoading || 
                isLoadingClasses || 
                (session?.user?.role === UserRole.REGULAR && (!form.getValues("classId") || !!classError))
              }
             >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
               Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
} 