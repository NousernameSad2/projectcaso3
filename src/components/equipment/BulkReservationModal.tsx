'use client';

import React, { useState, useEffect } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Class, User, ReservationType, UserRole } from '@prisma/client';
import { useSession } from 'next-auth/react';
import { toast } from "sonner";
import { format, isAfter, addHours } from 'date-fns';

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Check, ChevronsUpDown, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// Define a type for the equipment details we need
interface EquipmentDetails {
  id: string;
  name: string;
  stockCount: number;
  quantity: number; // Add quantity for user to adjust
}

const BulkReservationFormSchema = z.object({
    requestedStartTime: z.date({ required_error: "Start time is required." }).refine(date => {
      const hours = date.getHours();
      return hours >= 6 && hours < 20;
    }, { message: "Reservation must be between 6:00 AM and 8:00 PM." }),
    requestedEndTime: z.date({ required_error: "End time is required." }).refine(date => {
      const hours = date.getHours();
      return hours >= 6 && hours < 20;
    }, { message: "Reservation must be between 6:00 AM and 8:00 PM." }),
    classId: z.string().optional(),
}).refine(data => !data.requestedStartTime || !data.requestedEndTime || isAfter(data.requestedEndTime, data.requestedStartTime), {
    message: "End time must be after start time.",
    path: ["requestedEndTime"], 
});

type BulkFormInput = z.infer<typeof BulkReservationFormSchema>;

type EnrolledClass = Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'>;
type Classmate = Pick<User, 'id' | 'name'>;

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
  
  const [reservationType, setReservationType] = useState<ReservationType>('OUT_OF_CLASS');
  const [selectedClassIdState, setSelectedClassIdState] = useState<string>("");

  const [selectedEquipmentDetails, setSelectedEquipmentDetails] = useState<EquipmentDetails[]>([]);
  const [isLoadingEquipmentDetails, setIsLoadingEquipmentDetails] = useState(false);

  const form = useForm<BulkFormInput>({
    resolver: zodResolver(BulkReservationFormSchema),
    defaultValues: {
      requestedStartTime: undefined,
      requestedEndTime: undefined,
      classId: "",
    },
  });
  
  const watchedStartTime = form.watch('requestedStartTime');

  useEffect(() => {
    if (watchedStartTime) {
      const newEndTime = addHours(watchedStartTime, 1);
      form.setValue('requestedEndTime', newEndTime, { shouldValidate: true, shouldDirty: true });
    }
  }, [watchedStartTime, form]);
  
  const { isSubmitting } = form.formState;

  useEffect(() => {
    const fetchEquipmentDetails = async () => {
      if (!isOpen || selectedEquipmentIds.length === 0) {
        setSelectedEquipmentDetails([]);
        return;
      }
      setIsLoadingEquipmentDetails(true);
      try {
        const equipmentPromises = selectedEquipmentIds.map(id =>
          fetch(`/api/equipment/${id}`).then(res => {
            if (!res.ok) {
              throw new Error(`Failed to fetch details for equipment ID: ${id}`);
            }
            return res.json();
          })
        );
        const results = await Promise.all(equipmentPromises);
        setSelectedEquipmentDetails(results.map(eq => ({ ...eq, quantity: 1 }))); // Initialize quantity to 1
      } catch (error) {
        console.error("Error fetching equipment details:", error);
        toast.error(error instanceof Error ? error.message : "Failed to load equipment details.");
        setSelectedEquipmentDetails([]);
      } finally {
        setIsLoadingEquipmentDetails(false);
      }
    };

    fetchEquipmentDetails();
  }, [isOpen, selectedEquipmentIds]);

  const handleQuantityChange = (equipmentId: string, change: number) => {
    setSelectedEquipmentDetails(prevDetails =>
      prevDetails.map(eq => {
        if (eq.id === equipmentId) {
          const newQuantity = eq.quantity + change;
          // Ensure quantity is at least 1 and not more than stockCount
          return { 
            ...eq, 
            quantity: Math.max(1, Math.min(newQuantity, eq.stockCount)) 
          };
        }
        return eq;
      })
    );
  };

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
    } catch (error: unknown) {
      console.error("Error fetching classes:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load classes.";
      setClassError(errorMessage);
      toast.error(`Failed to load classes: ${errorMessage}`);
      setEnrolledClasses([]);
    } finally {
      setIsLoadingClasses(false);
    }
  };

  useEffect(() => {
    const fetchClassmates = async () => {
      if (!selectedClassIdState) {
        setClassmates([]);
        setSelectedClassmateIds(new Set());
        return;
      }
      if (sessionStatus !== 'authenticated' || !session?.user?.id) {
        setClassmates([]);
        setSelectedClassmateIds(new Set());
        return;
      }
      
      setIsLoadingClassmates(true);
      try {
        const response = await fetch(`/api/classes/${selectedClassIdState}/students`);
        if (!response.ok) {
           const errorData = await response.json().catch(() => ({}));
           throw new Error(errorData.message || 'Failed to fetch classmates.');
        }
        const data = await response.json();
        const filteredData = (data as Classmate[]).filter(cm => cm.id !== session?.user?.id);
        setClassmates(filteredData);
        setSelectedClassmateIds(new Set()); 
      } catch (error) { 
         console.error("Error fetching classmates:", error);
         toast.error(error instanceof Error ? error.message : "Could not load classmates for the selected class.");
         setClassmates([]);
         setSelectedClassmateIds(new Set());
      } 
      finally { setIsLoadingClassmates(false); }
    };
    fetchClassmates();
  }, [selectedClassIdState, sessionStatus, session?.user?.id]);

  async function onSubmit(values: BulkFormInput) {
    if (sessionStatus !== 'authenticated' || !session?.user?.id) {
      toast.error("Authentication required."); return;
    }
    
    const userRole = session.user.role;

    if (userRole === UserRole.REGULAR && (!values.classId || values.classId.trim() === "")) {
       form.setError("classId", { message: "Class selection is required for students." });
       return; 
    }

    const finalClassId = (userRole === UserRole.REGULAR || (values.classId && values.classId.trim() !== "")) ? values.classId : null;

    if (!values.requestedStartTime || !values.requestedEndTime) {
      toast.error("Start and end times are required.");
      return;
    }

    if (!isAfter(values.requestedEndTime, values.requestedStartTime)) {
        form.setError("requestedEndTime", { message: "End time must be after start time." });
        toast.error("End date/time must be after start date/time.");
        return;
    }

    try {
      const payload = {
          equipmentRequests: selectedEquipmentDetails.map(eq => ({
            equipmentId: eq.id,
            quantity: eq.quantity,
          })),
          classId: finalClassId,
          requestedStartTime: values.requestedStartTime.toISOString(),
          requestedEndTime: values.requestedEndTime.toISOString(),
          groupMateIds: Array.from(selectedClassmateIds),
          reservationType: reservationType,
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
      setSelectedClassIdState("");
      setSelectedClassmateIds(new Set());
      setEnrolledClasses([]);
      setClassmates([]);
      setClassError(null);
      setReservationType('OUT_OF_CLASS');
      setSelectedEquipmentDetails([]); // Clear equipment details on close
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
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bulk Reservation Request</DialogTitle>
          <DialogDescription>
            Requesting reservation for {selectedEquipmentIds.length} items. 
          </DialogDescription>
        </DialogHeader>
        
        <div className="md:grid md:grid-cols-2 md:gap-6">
          <div className="md:col-span-1 space-y-3 my-4 max-h-96 overflow-y-auto pr-2">
            <h4 className="font-medium text-sm sticky top-0 bg-background py-1">Selected Equipment:</h4>
            {isLoadingEquipmentDetails && <Loader2 className="mx-auto my-4 h-6 w-6 animate-spin" />}
            {!isLoadingEquipmentDetails && selectedEquipmentDetails.length > 0 && (
              <>
                {selectedEquipmentDetails.map((equipment) => (
                  <div key={equipment.id} className="flex items-center justify-between p-2 border rounded-md">
                    <div>
                      <p className="text-sm font-medium">{equipment.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Available: {equipment.stockCount}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={() => handleQuantityChange(equipment.id, -1)}
                        disabled={equipment.quantity <= 1}
                      >
                        -
                      </Button>
                      <span>{equipment.quantity}</span>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={() => handleQuantityChange(equipment.id, 1)}
                        disabled={equipment.quantity >= equipment.stockCount}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {!isLoadingEquipmentDetails && selectedEquipmentIds.length > 0 && selectedEquipmentDetails.length === 0 && (
                <p className="text-sm text-muted-foreground my-4">Could not load details for selected equipment.</p>
            )}
            {!isLoadingEquipmentDetails && selectedEquipmentDetails.length === 0 && selectedEquipmentIds.length > 0 && (
                 <p className="text-sm text-muted-foreground my-4">No equipment selected or details unavailable.</p>
            )}
          </div>

          <div className="md:col-span-1">
            <div className="space-y-2 mb-4">
                <Label className="text-sm font-medium">Reservation Purpose</Label>
                <RadioGroup 
                    defaultValue="OUT_OF_CLASS" 
                    className="grid grid-cols-2 gap-4"
                    value={reservationType}
                    onValueChange={(value: string) => setReservationType(value as ReservationType)}
                >
                    <div>
                        <RadioGroupItem value="IN_CLASS" id="inClass" className="peer sr-only" />
                        <Label 
                            htmlFor="inClass" 
                            className="flex items-center justify-center rounded-md border-2 border-[hsl(var(--muted))] bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[hsl(var(--primary))] peer-data-[state=unchecked]:border-[hsl(var(--muted))] cursor-pointer text-sm no-global-animation"
                        >
                            In Class
                        </Label>
                    </div>
                    <div>
                        <RadioGroupItem value="OUT_OF_CLASS" id="outClass" className="peer sr-only" />
                        <Label 
                            htmlFor="outClass" 
                            className="flex items-center justify-center rounded-md border-2 border-[hsl(var(--muted))] bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[hsl(var(--primary))] peer-data-[state=unchecked]:border-[hsl(var(--muted))] cursor-pointer text-sm no-global-animation"
                        >
                            Out of Class
                        </Label>
                    </div>
                </RadioGroup>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} id="bulk-reservation-form" className="space-y-4">
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
                            name={field.name}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            value={field.value ? format(new Date(field.value), "yyyy-MM-dd'T'HH:mm") : ''}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
                            min={nowDateTimeLocal}
                            disabled={isSubmitting}
                            className="block w-full"
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
                            name={field.name}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            value={field.value ? format(new Date(field.value), "yyyy-MM-dd'T'HH:mm") : ''}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
                            min={minEndTime}
                            disabled={isSubmitting || !startTimeValue}
                            className="block w-full"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                          field.onChange(value === "NONE_OR_GENERAL_USE" ? "" : value);
                          setSelectedClassIdState(value === "NONE_OR_GENERAL_USE" ? "" : value); 
                        }}
                        value={field.value ?? ""}
                        disabled={isLoadingClasses || (enrolledClasses.length === 0 && session?.user?.role === UserRole.REGULAR)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={isLoadingClasses ? "Loading..." : (session?.user?.role !== UserRole.REGULAR ? "Select class (Optional)" : "Select the class")} />
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
                                  {classError || "No enrolled classes found. Please enroll first or contact support."}
                                </SelectItem>
                              )
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                              disabled={!selectedClassIdState || isLoadingClassmates || classmates.length === 0}
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
                                             e.stopPropagation();
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
                                     value={classmate.name ?? classmate.id}
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
                   <FormDescription>Select classmates you are borrowing with (requires selecting a class first).</FormDescription>
                  <FormMessage />
                </FormItem>
              </form>
            </Form>
          </div>
        </div>
        
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            type="submit"
            form="bulk-reservation-form"
            disabled={isSubmitting || (session?.user?.role === UserRole.REGULAR && (!form.getValues("classId") || !!classError))}
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 