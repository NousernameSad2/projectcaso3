'use client';

import React, { useState, useEffect } from 'react';
import { Deficiency, DeficiencyStatus, UserRole, Borrow, Equipment, User } from '@prisma/client';
import { Button } from "@/components/ui/button";
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';

// Moved type definition here
// Type for deficiency data fetched from API
export type DeficiencyWithDetails = Deficiency & {
  user: Pick<User, 'id' | 'name' | 'email'>;
  taggedBy: Pick<User, 'id' | 'name'>;
  ficToNotify?: Pick<User, 'id' | 'name'> | null;
  borrow: Pick<Borrow, 'id'> & {
    equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId'>;
  };
};

interface EditDeficiencyDialogProps {
  deficiency: DeficiencyWithDetails;
  triggerButton: React.ReactNode; // The button that opens the dialog
  onUpdateSuccess: () => void; // Callback after successful update
}

export default function EditDeficiencyDialog({ 
    deficiency, 
    triggerButton, 
    onUpdateSuccess 
}: EditDeficiencyDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<DeficiencyStatus>(deficiency.status);
    const [description, setDescription] = useState(deficiency.description || '');
    const [resolution, setResolution] = useState(deficiency.resolution || '');
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

    // Reset form state when deficiency data changes (if dialog is reused)
    useEffect(() => {
        setStatus(deficiency.status);
        setDescription(deficiency.description || '');
        setResolution(deficiency.resolution || '');
        setErrors({});
    }, [deficiency]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setErrors({});

        // Construct payload with only changed fields
        const payload: Partial<Pick<Deficiency, 'status' | 'description' | 'resolution'>> = {};
        if (status !== deficiency.status) payload.status = status;
        if (description !== (deficiency.description || '')) payload.description = description;
        if (resolution !== (deficiency.resolution || '')) payload.resolution = resolution;

        if (Object.keys(payload).length === 0) {
            toast.info("No changes detected.");
            setIsLoading(false);
            setIsOpen(false);
            return;
        }

        try {
            const response = await fetch(`/api/deficiencies/${deficiency.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok) {
                 if (response.status === 400 && result.errors) {
                    setErrors(result.errors);
                 }
                throw new Error(result.message || 'Failed to update deficiency');
            }

            toast.success('Deficiency updated successfully!');
            onUpdateSuccess(); // Trigger data refresh in the parent list
            setIsOpen(false); // Close the dialog

        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
            toast.error(message);
            console.error("Update Deficiency Error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {triggerButton}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Deficiency Record</DialogTitle>
                    <DialogDescription>
                        Update the status, description, or resolution notes. 
                        Equipment: <span className='font-medium'>{deficiency.borrow.equipment.name}</span> | 
                        User: <span className='font-medium'>{deficiency.user.name}</span>
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    {/* Status */}
                    <div>
                        <Label htmlFor="edit-status">Status *</Label>
                        <Select 
                            value={status} 
                            onValueChange={(value) => setStatus(value as DeficiencyStatus)} 
                            required
                        >
                            <SelectTrigger id="edit-status">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(DeficiencyStatus).map((dstatus) => (
                                    <SelectItem key={dstatus} value={dstatus}>
                                        {dstatus.replace('_', ' ')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                         {errors.status && <p className="text-xs text-destructive mt-1">{errors.status.join(', ')}</p>}
                    </div>

                    {/* Description */} 
                    <div>
                        <Label htmlFor="edit-description">Description</Label>
                        <Textarea 
                            id="edit-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Provide details about the deficiency (optional)"
                            rows={3}
                        />
                         {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.join(', ')}</p>}
                    </div>

                     {/* Resolution */} 
                    <div>
                        <Label htmlFor="edit-resolution">Resolution Notes</Label>
                        <Textarea 
                            id="edit-resolution"
                            value={resolution}
                            onChange={(e) => setResolution(e.target.value)}
                            placeholder="Add notes about how the deficiency was resolved (optional)"
                             rows={3}
                        />
                         {errors.resolution && <p className="text-xs text-destructive mt-1">{errors.resolution.join(', ')}</p>}
                    </div>

                    <DialogFooter>
                         <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={isLoading}>Cancel</Button>
                         </DialogClose>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
} 