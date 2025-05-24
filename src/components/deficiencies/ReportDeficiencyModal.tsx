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
  equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId'>;
  borrower: { id: string; name: string | null; email: string | null; };
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
  itemsToReport: BorrowItemForModal[];
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
     let identifier: string | undefined | null = undefined;
     let isGroupLocal = false;

     if (itemsToReport.length === 1 && itemsToReport[0]) {
         identifier = itemsToReport[0].id;
         isGroupLocal = false;
     } else if (itemsToReport.length > 1 && itemsToReport[0]?.borrowGroupId) {
         identifier = itemsToReport[0].borrowGroupId;
         isGroupLocal = true;
     }

     if (!identifier) {
          toast.error("Could not determine item/group for return request.");
          return;
     }

     if (isSubmittingDeficiency) return;

     setIsSubmittingDeficiency(true);
     try {
         await onReturnRequestInitiated(
           identifier,
           isGroupLocal,
           requestData === 'yes',
           requestData === 'yes' ? { remarks: dataRequestRemarks, equipmentIds: selectedDataRequestEquipmentIds } : undefined
         );
         onOpenChange(false);
     } catch (error) {
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
            You can also request data extraction for this borrow transaction.
            When finished, click &quot;Initiate Return Request&quot;.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleReportDeficiency)} className="space-y-4 py-2">
             {isGroup && (
                <FormField
                  control={form.control}
                  name="selectedBorrowId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Select Item to Report Issue For</FormLabel>
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

            <div className="space-y-2 pt-4 border-t mt-4">
                <FormLabel>Request Data Extraction by Admin?</FormLabel>
                <RadioGroup
                    value={requestData}
                    onValueChange={(value: 'yes' | 'no') => setRequestData(value)}
                    className="flex space-x-4 pt-1"
                >
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id={`modal-data-req-no-${itemsToReport[0]?.id || 'new'}`} />
                        <FormLabel htmlFor={`modal-data-req-no-${itemsToReport[0]?.id || 'new'}`} className="font-normal">No</FormLabel>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id={`modal-data-req-yes-${itemsToReport[0]?.id || 'new'}`} />
                        <FormLabel htmlFor={`modal-data-req-yes-${itemsToReport[0]?.id || 'new'}`} className="font-normal">Yes</FormLabel>
                    </div>
                </RadioGroup>
            </div>

            {requestData === 'yes' && (
                <div className="space-y-3 p-4 border rounded-md mt-2">
                    <div className="space-y-2">
                        <FormLabel>Select Equipment for Data Request (Optional):</FormLabel>
                        <p className="text-xs text-muted-foreground">If none selected, data request applies to all items in this transaction.</p>
                        <div className="max-h-32 overflow-y-auto space-y-1 rounded-md border p-2">
                            {itemsToReport.length > 0 ? (
                                itemsToReport.map(item => (
                                    <div key={`data-req-equip-chk-${item.equipment.id}`} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`data-req-equip-${item.id}-${item.equipment.id}`}
                                            checked={selectedDataRequestEquipmentIds.includes(item.equipment.id)}
                                            onCheckedChange={(checked) => {
                                                setSelectedDataRequestEquipmentIds(prev =>
                                                    checked
                                                        ? [...prev, item.equipment.id]
                                                        : prev.filter(id => id !== item.equipment.id)
                                                );
                                            }}
                                        />
                                        <Label htmlFor={`data-req-equip-${item.id}-${item.equipment.id}`} className="font-normal text-sm">
                                            {item.equipment.name} {item.equipment.equipmentId ? `(${item.equipment.equipmentId})` : ''}
                                        </Label>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground px-1">No specific equipment items available for selection.</p>
                            )}
                        </div>
                    </div>

                    <FormItem>
                        <FormLabel htmlFor={`modal-data-req-remarks-${itemsToReport[0]?.id || 'new'}`}>Data Request Remarks (Optional)</FormLabel>
                        <Textarea
                            id={`modal-data-req-remarks-${itemsToReport[0]?.id || 'new'}`}
                            value={dataRequestRemarks}
                            onChange={(e) => setDataRequestRemarks(e.target.value)}
                            placeholder="e.g., Please extract flight logs from the drone between 2 PM and 3 PM."
                            rows={3}
                            className='w-full'
                        />
                    </FormItem>
                </div>
            )}

            <DialogFooter className="gap-2 mt-6 pt-4 border-t">
                <Button
                    type="submit"
                    disabled={isSubmittingDeficiency || !selectedItem}
                    variant="default"
                >
                    {isSubmittingDeficiency ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Report Issue for Selected
                </Button>
                 <Button
                    type="button"
                    variant="secondary"
                    onClick={proceedToReturnRequest}
                    disabled={isSubmittingDeficiency}
                    className="bg-green-600 hover:bg-green-700 text-white"
                >
                    {isSubmittingDeficiency ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Initiate Return Request
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 