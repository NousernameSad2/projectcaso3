'use client';

import React, { useState, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
// No DatePicker needed for direct checkout
import { toast } from "sonner";
import { Class } from '@prisma/client';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface BulkCheckoutModalProps {
  selectedEquipmentIds: string[];
  triggerButton?: React.ReactNode;
  onCheckoutSuccess?: (borrowGroupId: string) => void; // Callback on success
  onClose?: () => void;
}

export default function BulkCheckoutModal({ 
  selectedEquipmentIds, 
  triggerButton, 
  onCheckoutSuccess,
  onClose 
}: BulkCheckoutModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [userClasses, setUserClasses] = useState<Class[]>([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch user's classes when the modal opens (same as reservation modal)
  useEffect(() => {
    if (isOpen) {
      const fetchClasses = async () => {
        setIsLoadingClasses(true);
        try {
          const response = await fetch('/api/user/classes');
          if (!response.ok) {
            throw new Error('Failed to fetch classes');
          }
          const data: Class[] = await response.json();
          setUserClasses(data);
        } catch (error) { 
          console.error("Error fetching user classes:", error);
          toast.error("Failed to load your classes. Please try again.");
        } finally {
          setIsLoadingClasses(false);
        }
      };
      fetchClasses();
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!selectedClassId || selectedEquipmentIds.length === 0) {
      toast.warning("Please select a class.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/borrows/bulk-checkout', { // Call bulk-checkout endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentIds: selectedEquipmentIds,
          classId: selectedClassId,
          // No requestedStartDate needed
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to perform checkout (${response.status})`);
      }

      toast.success(result.message || "Items checked out successfully!");
      if (onCheckoutSuccess && result.borrowGroupId) {
        onCheckoutSuccess(result.borrowGroupId);
      }
      setIsOpen(false); // Close modal on success

    } catch (error) {
      console.error("Bulk checkout failed:", error);
      toast.error(error instanceof Error ? error.message : "An unknown error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && onClose) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      {!triggerButton && (
        <DialogTrigger asChild>
          <Button variant="outline" disabled={selectedEquipmentIds.length === 0}>
            Checkout Selected ({selectedEquipmentIds.length})
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Bulk Checkout</DialogTitle>
          <DialogDescription>
            Checking out {selectedEquipmentIds.length} items. Select the associated class.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Class Selection */} 
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="class" className="text-right">
              Class
            </Label>
            {isLoadingClasses ? (
              <div className="col-span-3 flex items-center"><LoadingSpinner size="sm" /> <span className='ml-2 text-sm text-muted-foreground'>Loading classes...</span></div>
            ) : userClasses.length > 0 ? (
              <Select
                value={selectedClassId}
                onValueChange={setSelectedClassId}
                disabled={isSubmitting}
              >
                <SelectTrigger id="class" className="col-span-3">
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {userClasses.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.courseCode} - {cls.section} ({cls.semester})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
               <p className="col-span-3 text-sm text-muted-foreground">No classes found or failed to load.</p>
            )}
          </div>
          {/* No Date Selection needed */}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            type="submit" 
            onClick={handleSubmit}
            disabled={isSubmitting || isLoadingClasses || !selectedClassId}
          >
            {isSubmitting ? <LoadingSpinner size="sm" className="mr-2" /> : null}
            Confirm Checkout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 