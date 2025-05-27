'use client';

import React, { useState, useEffect } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { EquipmentSchema, EquipmentInput } from "@/lib/schemas";
import { Equipment, EquipmentCategory, EquipmentStatus, UserRole } from "@prisma/client";
import { useSession } from 'next-auth/react';
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ArrowLeft } from 'lucide-react';

export default function EditEquipmentPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { data: session, status: sessionStatus } = useSession();

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<Equipment | null>(null);
  const [maintenanceNotes, setMaintenanceNotes] = useState<string>("");

  const form = useForm<EquipmentInput>({
    resolver: zodResolver(EquipmentSchema),
    defaultValues: {
      name: "",
      equipmentId: "",
      category: EquipmentCategory.INSTRUMENTS,
      condition: "",
      status: EquipmentStatus.AVAILABLE,
      stockCount: 0,
      purchaseCost: undefined,
      imageUrl: "",
      instrumentManualUrl: "",
    },
  });

  const currentStatus = form.watch("status");

  useEffect(() => {
    if (sessionStatus === 'loading') return;

    if (sessionStatus === 'unauthenticated') {
      toast.error("You must be logged in to edit equipment.");
      router.push('/login');
      return;
    }

    if (session?.user?.role === UserRole.REGULAR) {
      toast.error("Unauthorized: You do not have permission to edit equipment.");
      router.push(`/equipment/${id}`);
      return;
    }
  }, [sessionStatus, session, router, id]);

  useEffect(() => {
    if (!id || session?.user?.role === UserRole.REGULAR) return;
    setIsFetching(true);
    setError(null);
    fetch(`/api/equipment/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to fetch equipment (${res.status})`);
        }
        return res.json();
      })
      .then((data: Equipment) => {
        setInitialData(data);
        form.reset({
          name: data.name,
          equipmentId: data.equipmentId || "",
          category: data.category,
          condition: data.condition || "",
          status: data.status,
          stockCount: data.stockCount,
          purchaseCost: data.purchaseCost ?? undefined,
          imageUrl: data.images?.[0] || "",
          instrumentManualUrl: data.instrumentManualUrl || "",
        });
      })
      .catch((err) => {
        console.error("Fetch Equipment Error:", err);
        setError(err instanceof Error ? err.message : "Failed to load equipment data");
      })
      .finally(() => setIsFetching(false));
  }, [id, form, session?.user?.role]);

  async function onSubmit(values: EquipmentInput) {
    if (session?.user?.role === UserRole.REGULAR) {
      toast.error("Unauthorized action.");
      return;
    }
    setIsLoading(true);
    setError(null);
    
    const submissionData = {
      ...values,
      maintenanceNotes: currentStatus === EquipmentStatus.UNDER_MAINTENANCE ? maintenanceNotes : undefined,
    };

    console.log("Submitting updated equipment:", submissionData);

    try {
      const response = await fetch(`/api/equipment/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to update equipment');
      }

      console.log("Equipment updated successfully:", data);
      router.push(`/equipment/${id}`);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      setError(errorMessage);
      console.error("Update Equipment Error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  if (sessionStatus === 'loading' || isFetching) {
    return <div className="flex justify-center items-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>;
  }

  if (sessionStatus === 'authenticated' && session?.user?.role === UserRole.REGULAR) {
    return <div className="text-center py-10">Redirecting...</div>;
  }

  if (error && !initialData && session?.user?.role !== UserRole.REGULAR) {
    return <div className="text-center text-destructive py-10">Error loading data: {error}</div>;
  }

  if (sessionStatus === 'authenticated' && session?.user?.role === UserRole.REGULAR) {
    return <div className="text-center py-10 text-muted-foreground">Access Denied.</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link
        href={initialData ? `/equipment/${id}` : '/equipment'}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
        <ArrowLeft className="h-4 w-4" />
        {initialData ? 'Back to Details' : 'Back to List'}
      </Link>
      <h1 className="text-2xl font-semibold text-white">Edit Equipment</h1>
      <p className="text-muted-foreground text-sm">Update the details for: {initialData?.name || '...'}</p>
      {error && !form.formState.isDirty && (
         <p className="text-sm font-medium text-destructive/90">Error: {error}</p>
      )}
      <Form {...form}>
         <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
           <FormField
             control={form.control}
             name="name"
             render={({ field }) => (
               <FormItem>
                 <FormLabel>Equipment Name</FormLabel>
                 <FormControl>
                   <Input placeholder="e.g., Total Station Trimble S5" {...field} disabled={isLoading} />
                 </FormControl>
                 <FormMessage />
               </FormItem>
             )}
           />

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
                    Unique identifier (leave blank if none). Cannot be changed if already set by system later.
                  </FormDescription>
                 <FormMessage />
               </FormItem>
             )}
           />
          
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <FormField
               control={form.control}
               name="category"
               render={({ field }) => (
                 <FormItem>
                   <FormLabel>Category</FormLabel>
                   <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}>
                     <FormControl>
                       <SelectTrigger className="w-full">
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

             <FormField
               control={form.control}
               name="status"
               render={({ field }) => (
                 <FormItem>
                   <FormLabel>Status</FormLabel>
                   <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}>
                     <FormControl>
                       <SelectTrigger className="w-full">
                         <SelectValue placeholder="Select status" />
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

           {currentStatus === EquipmentStatus.UNDER_MAINTENANCE && (
              <FormItem>
                <FormLabel>Maintenance Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Enter notes about why this equipment is under maintenance..."
                    value={maintenanceNotes}
                    onChange={(e) => setMaintenanceNotes(e.target.value)}
                    disabled={isLoading}
                    rows={4}
                  />
                </FormControl>
                <FormDescription>
                  These notes will be added to the maintenance log if the status is being changed to &apos;Under Maintenance&apos;.
                </FormDescription>
              </FormItem>
           )}

           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="stockCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock Count</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" {...field} onChange={event => field.onChange(event.target.value === '' ? '' : +event.target.value)} disabled={isLoading} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchaseCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Cost (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g., 5000.00"
                        {...field}
                        value={field.value ?? ''}
                        onChange={event => field.onChange(event.target.value === '' ? null : +event.target.value)}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
           </div>

           <FormField
             control={form.control}
             name="condition"
             render={({ field }) => (
               <FormItem>
                 <FormLabel>Description</FormLabel>
                 <FormControl>
                   <Textarea
                     placeholder="Describe the current condition..."
                     className="resize-none"
                     {...field}
                     disabled={isLoading}
                     rows={4}
                   />
                 </FormControl>
                 <FormMessage />
               </FormItem>
             )}
           />

           <FormField
             control={form.control}
             name="imageUrl"
             render={({ field }) => (
               <FormItem>
                 <FormLabel>Image URL (Optional)</FormLabel>
                 <FormControl>
                   <Input type="text" placeholder="https://example.com/image.png or /images/local.png" {...field} value={field.value ?? ''} disabled={isLoading} />
                 </FormControl>
                 <FormMessage />
               </FormItem>
             )}
           />

           {/* Conditionally render Instrument Manual URL field */}
           {form.watch("category") === EquipmentCategory.INSTRUMENTS && (
            <FormField
              control={form.control}
              name="instrumentManualUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Instrument Manual URL (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g., https://manuals.example.com/trimble-s5.pdf" 
                      {...field} 
                      value={field.value ?? ''} // Ensure value is not null for input
                      disabled={isLoading} 
                    />
                  </FormControl>
                  <FormDescription>
                    A link to the instrument&apos;s user manual (e.g., Google Drive link).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

           <Button type="submit" disabled={isLoading || isFetching}>
             {isLoading ? "Saving Changes..." : "Save Changes"}
           </Button>
         </form>
       </Form>
    </div>
  );
} 