'use client';

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  // DialogTrigger, // Trigger will be controlled externally
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeficiencyType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ConfirmReturnModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (returnData: { 
      returnCondition?: string; 
      returnRemarks?: string; 
      logDeficiency?: boolean; 
      deficiencyType?: DeficiencyType;
      deficiencyDescription?: string;
   }) => void;
  isSubmitting: boolean;
  borrowId: string | null; // ID of the borrow being returned
  equipmentName?: string; // Optional: display name for context
}

export default function ConfirmReturnModal({ 
  isOpen,
  onOpenChange,
  onSubmit,
  isSubmitting,
  borrowId,
  equipmentName = 'this item' // Default context
}: ConfirmReturnModalProps) {
  const [condition, setCondition] = useState('');
  const [remarks, setRemarks] = useState('');
  const [logDeficiency, setLogDeficiency] = useState(false);
  const [deficiencyType, setDeficiencyType] = useState<DeficiencyType | undefined>(undefined);
  const [deficiencyDescription, setDeficiencyDescription] = useState('');

  // Reset fields when modal opens/closes or borrowId changes
  React.useEffect(() => {
    if (!isOpen) {
      setCondition('');
      setRemarks('');
      setLogDeficiency(false);
      setDeficiencyType(undefined);
      setDeficiencyDescription('');
    }
  }, [isOpen]);

  const handleSubmitClick = () => {
    const dataToSubmit: Parameters<typeof onSubmit>[0] = {
        returnCondition: condition || undefined,
        returnRemarks: remarks || undefined,
    };
    if (logDeficiency) {
       dataToSubmit.logDeficiency = true;
       dataToSubmit.deficiencyType = deficiencyType;
       dataToSubmit.deficiencyDescription = deficiencyDescription || undefined;
       if (!deficiencyType) {
          toast.error("Please select a deficiency type.");
          return;
       }
    }
    onSubmit(dataToSubmit);
  };

  const deficiencyTypeOptions = Object.values(DeficiencyType);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Confirm Return: {equipmentName}</DialogTitle>
          <DialogDescription>
             Record the condition and any remarks for the return of borrow request ID: {borrowId || 'N/A'}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Return Condition */} 
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="return-condition" className="text-right">
              Condition
            </Label>
            <Input
              id="return-condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g., Good, Minor scratches, etc."
              className="col-span-3"
              disabled={isSubmitting}
            />
          </div>
          {/* Return Remarks */} 
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="return-remarks" className="text-right pt-2">
              Remarks
            </Label>
            <Textarea
              id="return-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any additional notes about the return..."
              className="col-span-3 min-h-[80px]"
              disabled={isSubmitting}
            />
          </div>
          
          {/* --- Deficiency Logging Section --- */} 
          <div className="col-span-4 border-t pt-4 mt-2"/>
          <div className="flex items-center space-x-2 col-span-4">
            <Checkbox 
              id="log-deficiency"
              checked={logDeficiency}
              onCheckedChange={(checked) => setLogDeficiency(Boolean(checked))} 
              disabled={isSubmitting}
            />
            <label
              htmlFor="log-deficiency"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Log Deficiency for this Return?
            </label>
          </div>

          {/* Conditional Deficiency Fields */} 
          <div className={cn("grid gap-4 col-span-4 pl-6", !logDeficiency && "hidden")}>
             {/* Deficiency Type Select */} 
             <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="deficiency-type" className="text-right">
                   Type
                </Label>
                <Select
                   value={deficiencyType}
                   onValueChange={(value) => setDeficiencyType(value as DeficiencyType)}
                   disabled={isSubmitting}
                >
                   <SelectTrigger id="deficiency-type" className="col-span-3">
                      <SelectValue placeholder="Select deficiency type" />
                   </SelectTrigger>
                   <SelectContent>
                      {deficiencyTypeOptions.map((type) => (
                         <SelectItem key={type} value={type}>
                            {type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ')}
                         </SelectItem>
                      ))}
                   </SelectContent>
                </Select>
             </div>
             {/* Deficiency Description Textarea */} 
             <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="deficiency-description" className="text-right pt-2">Description</Label>
                <Textarea 
                  id="deficiency-description"
                  value={deficiencyDescription}
                  onChange={(e) => setDeficiencyDescription(e.target.value)}
                  placeholder="Details about the deficiency..." 
                  className="col-span-3 min-h-[60px]"
                  disabled={isSubmitting}
                />
             </div>
          </div>
          {/* --- End Deficiency Logging Section --- */} 
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmitClick}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoadingSpinner size="sm" className="mr-2" /> : null}
            Confirm Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 