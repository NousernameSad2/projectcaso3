'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from 'lucide-react';
import { Prisma } from '@prisma/client'; // Removed Borrow, BorrowStatus
import { format, parseISO } from 'date-fns';

// Define the expected shape of reservation data passed to the modal
// Use Prisma.BorrowGetPayload to get the type with relations if needed
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const borrowWithRelations = Prisma.validator<Prisma.BorrowDefaultArgs>()({
  include: { equipment: { select: { name: true } } } // Example relation
});
type ReservationData = Prisma.BorrowGetPayload<typeof borrowWithRelations>;

// Define the Zod schema for the edit form
const EditReservationSchema = z.object({
  // Add fields that can be edited, e.g., approved times
  approvedStartTime: z.coerce.date({ required_error: "Approved start time is required." }),
  approvedEndTime: z.coerce.date({ required_error: "Approved end time is required." }),
  // Add other editable fields like classId? borrowerId? Needs clarification.
}).refine(data => data.approvedEndTime > data.approvedStartTime, {
  message: "Approved end time must be after start time.",
  path: ["approvedEndTime"],
});

type EditReservationInput = z.infer<typeof EditReservationSchema>;

interface EditReservationModalProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  reservationData: ReservationData; // Data for the reservation being edited
  onSuccess: () => void; // Callback on successful update
}

export default function EditReservationModal({ 
    isOpen, 
    setIsOpen, 
    reservationData, 
    onSuccess 
}: EditReservationModalProps) {
    
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<EditReservationInput>({
    resolver: zodResolver(EditReservationSchema),
    defaultValues: {
        // Initialize with existing data, handle potential nulls
        approvedStartTime: reservationData.approvedStartTime ? new Date(reservationData.approvedStartTime) : (reservationData.requestedStartTime ? new Date(reservationData.requestedStartTime) : undefined),
        approvedEndTime: reservationData.approvedEndTime ? new Date(reservationData.approvedEndTime) : (reservationData.requestedEndTime ? new Date(reservationData.requestedEndTime) : undefined),
        // Initialize other fields...
    },
  });

  useEffect(() => {
    // Reset form when reservationData changes (e.g., opening modal for different item)
    form.reset({
        approvedStartTime: reservationData.approvedStartTime ? new Date(reservationData.approvedStartTime) : (reservationData.requestedStartTime ? new Date(reservationData.requestedStartTime) : undefined),
        approvedEndTime: reservationData.approvedEndTime ? new Date(reservationData.approvedEndTime) : (reservationData.requestedEndTime ? new Date(reservationData.requestedEndTime) : undefined),
    });
  }, [reservationData, form]);

  async function onSubmit(values: EditReservationInput) {
    setIsLoading(true);
    console.log("Updating reservation:", reservationData.id, "with values:", values);
    try {
      // Call PATCH /api/borrows/[borrowId]
      const response = await fetch(`/api/borrows/${reservationData.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, // Assumes authentication is handled via cookie/session
        body: JSON.stringify({ 
            // Only send fields being updated
            approvedStartTime: values.approvedStartTime,
            approvedEndTime: values.approvedEndTime,
            // Add other fields if necessary
         }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update reservation.');
      }

      toast.success("Reservation updated successfully!");
      onSuccess(); // Trigger callback (closes modal, refetches data)

    } catch (error: unknown) {
      console.error("Update Error:", error);
      const message = error instanceof Error ? error.message : 'Could not update reservation.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  // Min/Max values for date pickers
  const nowDateTimeLocal = format(new Date(), "yyyy-MM-dd'T'HH:mm");
  const startTimeValue = form.watch('approvedStartTime');
  const minEndTime = startTimeValue ? format(startTimeValue, "yyyy-MM-dd'T'HH:mm") : nowDateTimeLocal;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Approved Reservation</DialogTitle>
           <DialogDescription>
             Adjust details for reservation of &quot;{reservationData.equipment?.name ?? 'Unknown Equipment'}&quot;. Current status: {reservationData.borrowStatus}
           </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
             <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                {/* Approved Start Time Input */} 
                <FormField
                    control={form.control}
                    name="approvedStartTime"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Approved Start Time</FormLabel>
                        <FormControl>
                        <Input
                            type="datetime-local"
                            value={field.value ? format(field.value, "yyyy-MM-dd'T'HH:mm") : ''}
                            onChange={(e) => field.onChange(e.target.value ? parseISO(e.target.value) : null)}
                            min={nowDateTimeLocal} // Allow selecting current/future
                            disabled={isLoading}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                {/* Approved End Time Input */} 
                <FormField
                    control={form.control}
                    name="approvedEndTime"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Approved End Time</FormLabel>
                        <FormControl>
                         <Input
                            type="datetime-local"
                            value={field.value ? format(field.value, "yyyy-MM-dd'T'HH:mm") : ''}
                            onChange={(e) => field.onChange(e.target.value ? parseISO(e.target.value) : null)}
                            min={minEndTime} // Ensure end > start
                            disabled={isLoading || !startTimeValue}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                {/* Add other editable fields here */} 
                
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isLoading || !form.formState.isValid}>
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