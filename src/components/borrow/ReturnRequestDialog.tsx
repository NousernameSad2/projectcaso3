'use client';

import React, { useState } from 'react';
import { DeficiencyType } from '@prisma/client';
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';

interface ReturnRequestDialogProps {
  borrowId: string;
  userId: string; // The ID of the user making the request (borrower)
  equipmentName: string;
  triggerButton: React.ReactNode;
  onReturnRequestSuccess: () => void;
}

export default function ReturnRequestDialog({ 
    borrowId, 
    userId, 
    equipmentName,
    triggerButton, 
    onReturnRequestSuccess 
}: ReturnRequestDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [type, setType] = useState<DeficiencyType | ''>('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [actionType, setActionType] = useState<'returnOnly' | 'logAndReturn' | null>(null);
    const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
    const [requestData, setRequestData] = useState<'no' | 'yes'>('no');
    const [dataRequestRemarks, setDataRequestRemarks] = useState('');

    const resetForm = () => {
        setType('');
        setDescription('');
        setErrors({});
        setRequestData('no');
        setDataRequestRemarks('');
    };
    
    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (!open) {
            resetForm();
            setActionType(null);
            setIsLoading(false);
        }
    };

    const requestReturnOnly = async () => {
        setActionType('returnOnly'); 
        setIsLoading(true);
        try {
            const response = await fetch(`/api/borrows/${borrowId}/request-return`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestData: requestData === 'yes',
                    dataRequestRemarks: requestData === 'yes' ? dataRequestRemarks : undefined,
                }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to request return: ${response.statusText}`);
            }
            toast.success('Return requested successfully.');
            onReturnRequestSuccess();
            handleOpenChange(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
            toast.error(message);
            console.error("Request Return Error:", err);
        } finally {
            setIsLoading(false);
            setActionType(null); 
        }
    };

    const logDeficiencyAndRequestReturn = async () => {
        setActionType('logAndReturn');
        setIsLoading(true);
        setErrors({});
        
        if (!type) {
            setErrors({ type: ["Please select a deficiency type."]});
            setIsLoading(false);
            setActionType(null);
            return;
        }

        try {
            const defResponse = await fetch('/api/deficiencies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    borrowId: borrowId,
                    userId: userId,
                    type: type,
                    description: description || undefined,
                }),
            });

            const defResult = await defResponse.json();
            if (!defResponse.ok) {
                 if (defResponse.status === 400 && defResult.errors) {
                    setErrors(defResult.errors);
                 }
                throw new Error(defResult.message || 'Failed to log deficiency');
            }
            toast.info('Deficiency logged.');

            const retResponse = await fetch(`/api/borrows/${borrowId}/request-return`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestData: requestData === 'yes',
                    dataRequestRemarks: requestData === 'yes' ? dataRequestRemarks : undefined,
                }),
            });
            if (!retResponse.ok) {
                const errorData = await retResponse.json().catch(() => ({}));
                toast.error(`Deficiency logged, but failed to request return: ${errorData.message || retResponse.statusText}`);
                console.error("Request Return Error after deficiency log:", errorData);
            } else {
                 toast.success('Deficiency logged and return requested successfully.');
            }
            
            onReturnRequestSuccess();
            handleOpenChange(false);

        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
            toast.error(`Error: ${message}`);
            console.error("Log Deficiency & Return Error:", err);
        } finally {
            setIsLoading(false);
            setActionType(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                {triggerButton}
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Request Return: {equipmentName}</DialogTitle>
                    <DialogDescription>
                        Report any issues or deficiencies with the equipment before requesting the return.
                        If there are no issues, you can proceed directly.
                    </DialogDescription>
                </DialogHeader>
                <div 
                    className="space-y-4 py-2" 
                    style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
                >
                    <div>
                        <Label htmlFor={`ret-def-type-${borrowId}`}>Issue/Deficiency Type (Optional)</Label>
                        <Select 
                            value={type} 
                            onValueChange={(value) => setType(value as DeficiencyType)} 
                        >
                            <SelectTrigger id={`ret-def-type-${borrowId}`} className='w-full'>
                                <SelectValue placeholder="Select type (if any)" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(DeficiencyType).map((dtype) => (
                                    <SelectItem key={dtype} value={dtype}>
                                        {dtype.replace('_', ' ')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.type && <p className="text-xs text-destructive mt-1">{errors.type.join(', ')}</p>}
                    </div>
                    <div>
                        <Label htmlFor={`ret-def-desc-${borrowId}`}>Description (Optional)</Label>
                        <Textarea 
                            id={`ret-def-desc-${borrowId}`}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Provide details about the issue (optional)"
                            rows={3}
                            className='w-full'
                        />
                         {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.join(', ')}</p>}
                    </div>

                    {/* Data Request Section */}
                    <div className="space-y-2 pt-2">
                        <Label>Request Data from this Borrow Transaction?</Label>
                        <RadioGroup
                            value={requestData}
                            onValueChange={(value: 'yes' | 'no') => setRequestData(value)}
                            className="flex space-x-4"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="no" id={`data-req-no-${borrowId}`} />
                                <Label htmlFor={`data-req-no-${borrowId}`}>No</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="yes" id={`data-req-yes-${borrowId}`} />
                                <Label htmlFor={`data-req-yes-${borrowId}`}>Yes</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {requestData === 'yes' && (
                        <div className="space-y-2">
                            <Label htmlFor={`data-req-remarks-${borrowId}`}>Data Request Remarks (Optional)</Label>
                            <Textarea 
                                id={`data-req-remarks-${borrowId}`}
                                value={dataRequestRemarks}
                                onChange={(e) => setDataRequestRemarks(e.target.value)}
                                placeholder="e.g., Sir Lowell, please extract specific logs"
                                rows={3}
                                className='w-full'
                            />
                        </div>
                    )}
                </div>
                <DialogFooter className="gap-2 sm:justify-between pt-4">
                     <Button 
                        type="button" 
                        variant="secondary" 
                        onClick={requestReturnOnly}
                        disabled={isLoading}
                    >
                        {isLoading && actionType === 'returnOnly' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Request Return Only
                    </Button>
                     <Button 
                        type="button" 
                        variant="destructive" 
                        onClick={logDeficiencyAndRequestReturn}
                        disabled={isLoading || !type}
                    >
                         {isLoading && actionType === 'logAndReturn' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                         <AlertTriangle className="mr-2 h-4 w-4" />
                        Log Deficiency & Request Return
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
} 