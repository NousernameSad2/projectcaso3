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
import { DeficiencyType } from '@prisma/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const LogDeficiencySchema = z.object({
  type: z.nativeEnum(DeficiencyType, {
    required_error: "Please select a deficiency type.",
  }),
  description: z.string().optional(),
});

type LogDeficiencyInput = z.infer<typeof LogDeficiencySchema>;

interface LogDeficiencyForItemModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  borrowId: string | null;
  equipmentName: string | null;
  onDeficiencyLogged?: () => void; // Optional callback
}

export default function LogDeficiencyForItemModal({
  isOpen,
  onOpenChange,
  borrowId,
  equipmentName,
  onDeficiencyLogged,
}: LogDeficiencyForItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LogDeficiencyInput>({
    resolver: zodResolver(LogDeficiencySchema),
    defaultValues: {
      type: undefined,
      description: "",
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({ type: undefined, description: "" });
    }
  }, [isOpen, form]);

  const handleSubmit = async (values: LogDeficiencyInput) => {
    if (!borrowId) {
      toast.error("Cannot log deficiency: Borrow ID is missing.");
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        borrowId: borrowId,
        type: values.type,
        description: values.description || undefined,
        // Note: userId (responsible user) is not set here,
        // backend will default to the borrower of the borrowId
      };

      const response = await fetch('/api/deficiencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || `Failed to log deficiency (${response.status})`);
      }
      
      toast.success(`Deficiency logged for ${equipmentName || 'item'}.`);
      if (onDeficiencyLogged) {
        onDeficiencyLogged();
      }
      onOpenChange(false); // Close modal
    } catch (error) {
      console.error("Failed to log deficiency:", error);
      toast.error(error instanceof Error ? error.message : "Could not log deficiency.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!borrowId) return null; // Don't render if borrowId not provided yet

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Deficiency for {equipmentName || "Item"}</DialogTitle>
          <DialogDescription>
            Select the type of deficiency and add a description if necessary.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-2">
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
                      {Object.values(DeficiencyType).map(typeValue => (
                        <SelectItem key={typeValue} value={typeValue}>
                          {typeValue.replace('_',' ')}
                        </SelectItem>
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
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Log Deficiency
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 