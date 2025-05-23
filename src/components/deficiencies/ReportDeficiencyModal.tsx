import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Borrow, Equipment, DeficiencyType } from '@prisma/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Define the shape of the borrow data expected (simplified for modal)
type BorrowItemForModal = Pick<Borrow, 'id' | 'borrowGroupId'> & {
  equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId' /* | 'isDataGenerating' */>;
};

// Zod schema for the deficiency form
const DeficiencyReportSchema = z.object({
  selectedBorrowId: z.string().min(1, "Please select the item you are reporting."),
  type: z.nativeEnum(DeficiencyType, { required_error: "Please select a deficiency type."}),
  description: z.string().optional(),
});
type DeficiencyReportInput = z.infer<typeof DeficiencyReportSchema>;

interface ReportDeficiencyModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  itemsToReport: BorrowItemForModal[]; // Can be single or multiple items
  onReturnRequestInitiated: (
    identifier: string, 
    isGroup: boolean,
    requestData?: boolean,
    dataRequestDetails?: { remarks?: string; equipmentIds?: string[] }
  ) => Promise<void>;
}

export default function ReportDeficiencyModal({
  isOpen,
  onOpenChange,
  itemsToReport,
  onReturnRequestInitiated,
}: ReportDeficiencyModalProps) {
  const [isSubmittingDeficiency, setIsSubmittingDeficiency] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BorrowItemForModal | null>(null);
  const [requestData, setRequestData] = useState<'no' | 'yes'>('no');
  const [dataRequestRemarks, setDataRequestRemarks] = useState('');
  const [selectedDataRequestEquipmentIds, setSelectedDataRequestEquipmentIds] = useState<string[]>([]);

  const form = useForm<DeficiencyReportInput>({
    resolver: zodResolver(DeficiencyReportSchema),
    defaultValues: {
      selectedBorrowId: itemsToReport.length === 1 ? itemsToReport[0].id : undefined,
      type: undefined,
      description: "",
    },
  });

  // Reset form when modal opens/closes or items change
  useEffect(() => {
    form.reset({
      selectedBorrowId: itemsToReport.length === 1 ? itemsToReport[0].id : undefined,
      type: undefined,
      description: "",
    });
    setSelectedItem(itemsToReport.length === 1 ? itemsToReport[0] : null);
    setRequestData('no');
    setDataRequestRemarks('');
    setSelectedDataRequestEquipmentIds([]);
  }, [isOpen, itemsToReport, form]);

  // Update selectedItem when dropdown changes
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name === 'selectedBorrowId') {
        setSelectedItem(itemsToReport.find(item => item.id === value.selectedBorrowId) || null);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, itemsToReport]);

  const handleReportDeficiency = async (values: DeficiencyReportInput) => {
    setIsSubmittingDeficiency(true);
    try {
        const payload = {
            borrowId: values.selectedBorrowId,
            type: values.type,
            description: values.description,
        };
        console.log("Submitting Deficiency Report:", payload);

        const response = await fetch('/api/deficiencies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || result.error || `Failed to report deficiency (${response.status})`);
        }
        
        toast.success("Deficiency reported successfully.");
        form.reset({
           selectedBorrowId: isGroup ? undefined : values.selectedBorrowId,
           type: undefined,
           description: "",
        });
        setSelectedItem(isGroup ? null : selectedItem);

    } catch (error) {
        console.error("Failed to report deficiency:", error);
        toast.error(error instanceof Error ? error.message : "Could not report deficiency.");
    } finally {
        setIsSubmittingDeficiency(false);
    }
  };

  const proceedToReturnRequest = async () => {
     // Determine identifier and isGroup based on initial items, not state
     let identifier: string | undefined | null = undefined;
     let isGroup = false;

     if (itemsToReport.length === 1 && itemsToReport[0]) {
         identifier = itemsToReport[0].id;
         isGroup = false; // Treat as individual return request API call
     } else if (itemsToReport.length > 1 && itemsToReport[0]?.borrowGroupId) {
         identifier = itemsToReport[0].borrowGroupId;
         isGroup = true; // Treat as group return request API call
     }

     if (!identifier) {
          console.error("Could not determine identifier for return request.", itemsToReport);
          toast.error("Could not determine item/group for return request.");
          return;
     }

     // Check if submitting before proceeding
     if (isSubmittingDeficiency) return;

     setIsSubmittingDeficiency(true);
     try {
         await onReturnRequestInitiated(
           identifier, 
           isGroup,
           requestData === 'yes',
           requestData === 'yes' ? { remarks: dataRequestRemarks, equipmentIds: selectedDataRequestEquipmentIds } : undefined
         ); 
         onOpenChange(false); // Close modal on success
     } catch (error) {
         // Error logging/toast handled in parent or trigger function
         console.error("Error during return request initiation:", error);
     } finally {
         setIsSubmittingDeficiency(false);
     }
  };

  const isGroup = itemsToReport.length > 1 || (itemsToReport[0]?.borrowGroupId != null);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Return & Report Issues</DialogTitle>
          <DialogDescription>
            Select items with issues and report them one by one. 
            When finished, click &quot;Initiate Return Request&quot;.
            If there are no issues, just click &quot;Initiate Return Request&quot;.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleReportDeficiency)} className="space-y-4 py-2">
             {/* Item Selector (only if multiple items) */}
             {isGroup && (
                <FormField
                  control={form.control}
                  name="selectedBorrowId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Select Item to Report</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select item..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {itemsToReport.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.equipment.name} {item.equipment.equipmentId ? `(${item.equipment.equipmentId})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
             )}

            {/* Only show deficiency fields if an item is selected */}
            {selectedItem && (
              <>
                 <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Deficiency Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select deficiency type..." />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                            {Object.values(DeficiencyType).map(type => (
                                <SelectItem key={type} value={type}>{type.replace('_',' ')}</SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                 <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl>
                            <Textarea
                            placeholder="Describe the issue..."
                            {...field}
                            />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
              </>
            )}

            {/* Data Request Section - Copied from ReturnRequestDialog and adapted */}
            <div className="space-y-2 pt-4 border-t mt-4">
                <FormLabel>Request Data from this Borrow Transaction?</FormLabel>
                <RadioGroup
                    value={requestData}
                    onValueChange={(value: 'yes' | 'no') => setRequestData(value)}
                    className="flex space-x-4 pt-1"
                >
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id={`def-modal-data-req-no`} />
                        <FormLabel htmlFor={`def-modal-data-req-no`} className="font-normal">No</FormLabel>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id={`def-modal-data-req-yes`} />
                        <FormLabel htmlFor={`def-modal-data-req-yes`} className="font-normal">Yes</FormLabel>
                    </div>
                </RadioGroup>
            </div>

            {requestData === 'yes' && (
                <div className="space-y-2">
                    {/* New: Item selection for data request */}
                    <div className="space-y-2 py-2">
                        <FormLabel>Select Equipment for Data Request:</FormLabel>
                        <div className="max-h-32 overflow-y-auto space-y-1 rounded-md border p-2">
                            {itemsToReport.length > 0 ? (
                                itemsToReport
                                    .map(item => (
                                        <div key={item.equipment.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`data-req-equip-${item.equipment.id}`}
                                                checked={selectedDataRequestEquipmentIds.includes(item.equipment.id)}
                                                onCheckedChange={(checked) => {
                                                    setSelectedDataRequestEquipmentIds(prev => 
                                                        checked 
                                                            ? [...prev, item.equipment.id] 
                                                            : prev.filter(id => id !== item.equipment.id)
                                                    );
                                                }}
                                            />
                                            <Label htmlFor={`data-req-equip-${item.equipment.id}`} className="font-normal text-sm">
                                                {item.equipment.name} {item.equipment.equipmentId ? `(${item.equipment.equipmentId})` : ''}
                                            </Label>
                                        </div>
                                    ))
                            ) : (
                                <p className="text-sm text-muted-foreground px-1">No equipment items in this selection.</p>
                            )}
                        </div>
                    </div>

                    <FormLabel htmlFor={`def-modal-data-req-remarks`}>Data Request Remarks (Optional)</FormLabel>
                    <Textarea 
                        id={`def-modal-data-req-remarks`}
                        value={dataRequestRemarks}
                        onChange={(e) => setDataRequestRemarks(e.target.value)}
                        placeholder="e.g., Please extract specific logs from the drone."
                        rows={3}
                        className='w-full'
                    />
                </div>
            )}

            <DialogFooter className="gap-2 mt-4">
                <Button 
                    type="button" 
                    variant="secondary"
                    onClick={proceedToReturnRequest}
                    disabled={isSubmittingDeficiency}
                >
                    Initiate Return Request
                </Button>
                <Button 
                    type="submit" 
                    disabled={isSubmittingDeficiency || !selectedItem}
                >
                    {isSubmittingDeficiency ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Report Issue for Selected Item
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 