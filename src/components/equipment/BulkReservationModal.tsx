'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { ReservationBaseSchema, ReservationInput } from "@/lib/schemas";
import { Equipment, Class, User } from '@prisma/client';
import { useSession } from 'next-auth/react';
import { toast } from "sonner";
import { format, parseISO, isAfter } from 'date-fns';

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Loader2, AlertCircle, Check, ChevronsUpDown, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const BulkReservationFormSchema = ReservationBaseSchema.omit({
  equipmentIds: true,
  groupMates: true
});

type BulkFormInput = z.infer<typeof BulkReservationFormSchema>;

interface EnrolledClass extends Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'> {}
interface Classmate extends Pick<User, 'id' | 'name'> {}

interface BulkReservationModalProps {
  selectedEquipmentIds: string[];
  triggerButton?: React.ReactNode;
  onReservationSuccess?: (borrowGroupId: string) => void;
  onClose?: () => void;
}

export default function BulkReservationModal({ 
  selectedEquipmentIds, 
  triggerButton, 
  onReservationSuccess,
  onClose 
}: BulkReservationModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: session, status: sessionStatus } = useSession();
  
  const [enrolledClasses, setEnrolledClasses] = useState<EnrolledClass[]>([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [isLoadingClassmates, setIsLoadingClassmates] = useState(false);
  const [selectedClassmateIds, setSelectedClassmateIds] = useState<Set<string>>(new Set());
  const [isClassmatePopoverOpen, setIsClassmatePopoverOpen] = useState(false);
  
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const form = useForm<BulkFormInput>({
    resolver: zodResolver(BulkReservationFormSchema),
    defaultValues: {
      requestedStartTime: undefined,
      requestedEndTime: undefined,
      classId: "",
    },
  });
  
  const { isSubmitting } = form.formState;

  const fetchClasses = async () => {
    setIsLoadingClasses(true);
    setClassError(null);
    try {
      const response = await fetch('/api/user/classes');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to load classes');
      }
      const data = await response.json();
      setEnrolledClasses(data as EnrolledClass[]);
    } catch (error: any) {
      console.error("Error fetching classes:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load classes.";
      setClassError(errorMessage);
      toast.error(`Failed to load classes: ${errorMessage}`);
      setEnrolledClasses([]);
    } finally {
      setIsLoadingClasses(false);
    }
  };

  // Fetch classmates when selectedClassId changes
  useEffect(() => {
    const fetchClassmates = async () => {
      if (!selectedClassId) {
        setClassmates([]);
        setSelectedClassmateIds(new Set()); // Clear selections if class changes
        return;
      }
      // Don't fetch if the user is not authenticated
      if (sessionStatus !== 'authenticated' || !session?.user?.id) {
        setClassmates([]);
        setSelectedClassmateIds(new Set());
        return;
      }
      
      setIsLoadingClassmates(true);
      try {
        const response = await fetch(`/api/classes/${selectedClassId}/students`);
        if (!response.ok) {
           const errorData = await response.json().catch(() => ({}));
           throw new Error(errorData.message || 'Failed to fetch classmates.');
        }
        const data = await response.json();
        // Filter out the logged-in user from the list
        const filteredData = (data as Classmate[]).filter(cm => cm.id !== session?.user?.id);
        setClassmates(filteredData);
        // Clear selections when classmates reload to avoid keeping stale IDs
        setSelectedClassmateIds(new Set()); 
      } catch (error) { 
         console.error("Error fetching classmates:", error);
         toast.error(error instanceof Error ? error.message : "Could not load classmates for the selected class.");
         setClassmates([]); // Clear on error
         setSelectedClassmateIds(new Set()); // Clear selections on error
      } 
      finally { setIsLoadingClassmates(false); }
    };
    fetchClassmates();
  }, [selectedClassId, sessionStatus, session?.user?.id]); // Depend on selectedClassId and session status/user id

  // --- Submission Handler ---
  async function onSubmit(values: BulkFormInput) {
    // Add session check here
    if (sessionStatus !== 'authenticated') {
      toast.error("Authentication required to make a reservation.");
      console.error("Attempted submission without authentication.");
      return; // Prevent submission
    }
    // End of session check

    const { requestedStartTime, requestedEndTime, classId } = values;

    if (!isAfter(requestedEndTime, requestedStartTime)) {
        toast.error("End date/time must be after start date/time.");
        form.setError("requestedEndTime", { message: "End time must be after start time." });
        return;
    }

    try {
      const payload = {
          equipmentIds: selectedEquipmentIds,
          classId: values.classId,
          requestedStartTime: values.requestedStartTime.toISOString(),
          requestedEndTime: values.requestedEndTime.toISOString(),
          groupMateIds: Array.from(selectedClassmateIds),
      };
      console.log("Submitting Bulk Reservation:", payload);
      
      const response = await fetch('/api/borrows/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || `Failed to submit reservation (${response.status})`);
      }

      toast.success(result.message || "Bulk reservation request submitted!");
      if (onReservationSuccess && result.borrowGroupId) {
        onReservationSuccess(result.borrowGroupId);
      }
      handleOpenChange(false);

    } catch (error) {
      console.error("Bulk reservation failed:", error);
      toast.error(error instanceof Error ? error.message : "An unknown error occurred.");
    }
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      form.reset();
      setSelectedClassId("");
      setSelectedClassmateIds(new Set());
      setEnrolledClasses([]);
      setClassmates([]);
      setClassError(null);
      if (onClose) {
        onClose();
      }
    } else {
      if (sessionStatus === 'authenticated') {
        fetchClasses();
      } else if (sessionStatus === 'unauthenticated') {
        setClassError("Authentication required to load classes.");
        toast.error("Please log in to make a reservation.");
      }
    }
  };

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

  const nowDateTimeLocal = format(new Date(), "yyyy-MM-dd'T'HH:mm");
  const startTimeValue = form.watch('requestedStartTime');
  const minEndTime = startTimeValue ? format(startTimeValue, "yyyy-MM-dd'T'HH:mm") : nowDateTimeLocal;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      {!triggerButton && (
        <DialogTrigger asChild>
          <Button variant="outline" disabled={selectedEquipmentIds.length === 0}>
            Reserve Selected ({selectedEquipmentIds.length})
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Reservation Request</DialogTitle>
          <DialogDescription>
            Requesting reservation for {selectedEquipmentIds.length} items. Select class, time, and group mates (optional).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} id="bulk-reservation-form" className="space-y-4 py-4">
             {/* Time Selection */}
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                          disabled={isSubmitting || !startTimeValue}
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
                  <FormLabel>Class (Required)</FormLabel>
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedClassId(value); // Update state to trigger classmate fetch
                    }}
                    value={field.value}
                    disabled={isLoadingClasses || enrolledClasses.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingClasses ? "Loading classes..." : "Select your class..."} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {isLoadingClasses ? (
                          <SelectItem value="loading" disabled>Loading...</SelectItem>
                      ) : enrolledClasses.length > 0 ? (
                        enrolledClasses.map((cls) => (
                          <SelectItem key={cls.id} value={cls.id}>
                            {`${cls.courseCode} ${cls.section} (${cls.semester})`}
                          </SelectItem>
                        ))
                      ) : (
                          <SelectItem value="no-classes" disabled>
                            {classError || "No enrolled classes found"}
                          </SelectItem>
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
                                {Array.from(selectedClassmateIds).map(id => {
                                  const mate = classmates.find(cm => cm.id === id);
                                  return (
                                    <Badge
                                      variant="secondary"
                                      key={id}
                                      className="mr-1 mb-1"
                                      onClick={(e) => { 
                                          e.stopPropagation(); // Prevent popover close
                                          toggleClassmate(id);
                                      }}
                                    >
                                      {mate?.name || 'Loading...'}
                                      <X className="ml-1 h-3 w-3 cursor-pointer" />
                                    </Badge>
                                  );
                                })}
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
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            type="submit"
            form="bulk-reservation-form"
            onClick={form.handleSubmit(onSubmit)}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 