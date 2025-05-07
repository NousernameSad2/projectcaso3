'use client';

import React, { useState } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EquipmentSchema, EquipmentInput } from "@/lib/schemas";
import { EquipmentCategory, EquipmentStatus } from "@prisma/client"; // Import enums

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea"; // For condition
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"; // For enums
import { ArrowLeft } from 'lucide-react';

export default function AddEquipmentPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<EquipmentInput>({
    resolver: zodResolver(EquipmentSchema),
    defaultValues: {
      name: "",
      equipmentId: "",
      category: EquipmentCategory.INSTRUMENTS,
      condition: "",
      status: EquipmentStatus.AVAILABLE,
      stockCount: 1,
      purchaseCost: undefined,
    },
  });

  async function onSubmit(values: EquipmentInput) {
    setIsLoading(true);
    setError(null);
    console.log("Submitting new equipment:", values);

    try {
      const response = await fetch('/api/equipment', { // POST to /api/equipment
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to add equipment');
      }

      console.log("Equipment added successfully:", data);
      // Redirect back to equipment list page on success
      router.push('/equipment');
      // Optionally show a success toast/message

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      setError(errorMessage);
      console.error("Add Equipment Error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link
        href="/equipment"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <>
          <ArrowLeft className="h-4 w-4" />
          Back to Equipment List
        </>
      </Link>
      <h1 className="text-2xl font-semibold text-white">Add New Equipment</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Equipment Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g., Total Station Trimble S5" {...field} disabled={isLoading} />
                </FormControl>
                <FormDescription>
                  The primary name or model of the equipment.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Equipment ID */}
          <FormField
            control={form.control}
            name="equipmentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Equipment ID (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="e.g., DGE-TS-015" {...field} disabled={isLoading} />
                </FormControl>
                <FormDescription>
                  A unique identifier assigned by the department.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Category */}
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(EquipmentCategory).map((cat) => (
                        <SelectItem key={cat} value={cat} className="capitalize">
                          {cat.toLowerCase().replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Status */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select initial status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(EquipmentStatus).map((stat) => (
                        <SelectItem key={stat} value={stat} className="capitalize">
                          {stat.toLowerCase().replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             {/* Stock Count */}
            <FormField
              control={form.control}
              name="stockCount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock Count</FormLabel>
                  <FormControl>
                    <Input 
                      type="text" 
                      inputMode="numeric" 
                      pattern="[0-9]*"
                      min="0"
                      {...field}
                      onChange={event => {
                        const value = event.target.value;
                        if (value === '' || /^[0-9]+$/.test(value)) {
                          field.onChange(value === '' ? 0 : parseInt(value, 10));
                        }
                      }}
                      value={field.value ?? ''}
                      disabled={isLoading} 
                    />
                  </FormControl>
                   <FormDescription>
                    How many units of this item are available?
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Purchase Cost */}
            <FormField
              control={form.control}
              name="purchaseCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Cost (Optional)</FormLabel>
                  <FormControl>
                    {/* Input type is number, but field value might be null/undefined */}
                    <Input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      placeholder="e.g., 5000.00" 
                      {...field}
                      value={field.value ?? ''} // Handle null/undefined for display
                      onChange={event => field.onChange(event.target.value === '' ? null : +event.target.value)} 
                      disabled={isLoading} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Condition */}
          <FormField
            control={form.control}
            name="condition"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe the current condition (e.g., Like New, Minor Scratches)"
                    className="resize-none"
                    {...field}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Image URL */}
          <FormField
            control={form.control}
            name="imageUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Image URL (Optional)</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="https://example.com/image.png or /images/local.png" {...field} value={field.value ?? ''} disabled={isLoading} />
                </FormControl>
                <FormDescription>
                  Paste a URL or enter a local path starting with /.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* TODO: Image Upload Field */}

          {error && (
            <p className="text-sm font-medium text-destructive/90">Error: {error}</p>
          )}

          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Adding Equipment..." : "Add Equipment"}
          </Button>
        </form>
      </Form>
    </div>
  );
} 