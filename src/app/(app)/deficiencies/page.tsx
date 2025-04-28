'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { UserRole, DeficiencyType } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Deficiency, User, Borrow, Equipment, DeficiencyStatus } from '@prisma/client';
import { format } from 'date-fns';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import EditDeficiencyDialog from '@/components/deficiencies/EditDeficiencyDialog';
import { DeficiencyWithDetails } from '@/components/deficiencies/EditDeficiencyDialog';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { DataTable } from "@/components/ui/data-table";
import { columns as allDeficiencyColumns, type DeficiencyAdminView } from "./columns";
import DeficiencyDetailsModal from '@/components/deficiencies/DeficiencyDetailsModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from 'lucide-react';

// Helper to get badge variant for DeficiencyStatus
const getDeficiencyStatusVariant = (status: DeficiencyStatus): "default" | "destructive" | "success" => {
  switch (status) {
    case DeficiencyStatus.UNRESOLVED: return "destructive";
    case DeficiencyStatus.RESOLVED: return "success";
    case DeficiencyStatus.UNDER_REVIEW: return "default"; // Or another color?
    default: return "default";
  }
};

// Type for User data fetched for dropdowns
interface UserSelectItem {
  value: string; // User ID
  label: string; // User Name (Email)
}

// --- COMPONENTS ---

// Form Component
function CreateDeficiencyForm() {
    const [borrowId, setBorrowId] = useState('');
    const [userId, setUserId] = useState<string | undefined>(undefined); // Store selected user ID
    const [type, setType] = useState<DeficiencyType | undefined>(undefined);
    const [description, setDescription] = useState('');
    const [ficToNotifyId, setFicToNotifyId] = useState<string | undefined>(undefined); // Store selected FIC/Staff ID
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

    // State for user dropdowns
    const [regularUsers, setRegularUsers] = useState<UserSelectItem[]>([]);
    const [privilegedUsers, setPrivilegedUsers] = useState<UserSelectItem[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);

    // Fetch users for dropdowns
    useEffect(() => {
        const fetchUsers = async () => {
            setIsLoadingUsers(true);
            try {
                // Fetch Regular Users
                const regRes = await fetch('/api/users?role=REGULAR');
                if (!regRes.ok) throw new Error('Failed to fetch regular users');
                const regData = await regRes.json();
                setRegularUsers(regData.map((u: any) => ({ value: u.id, label: `${u.name} (${u.email})` })) || []);

                // Fetch Staff and Faculty
                const privRes = await fetch('/api/users?role=STAFF&role=FACULTY'); // Use multiple params
                if (!privRes.ok) throw new Error('Failed to fetch staff/faculty');
                const privData = await privRes.json();
                setPrivilegedUsers(privData.map((u: any) => ({ value: u.id, label: `${u.name} (${u.email})` })) || []);
                
            } catch (error) {
                console.error("Failed to fetch users for dropdowns:", error);
                toast.error("Could not load users for dropdowns.");
                // Set empty arrays on error
                setRegularUsers([]);
                setPrivilegedUsers([]);
            } finally {
                setIsLoadingUsers(false);
            }
        };
        fetchUsers();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setErrors({});

        // Validate dropdown selections
        if (!userId) {
             setErrors(prev => ({ ...prev, userId: ["Responsible user must be selected."] }));
             setIsLoading(false);
             return;
        }
        if (!type) {
             setErrors(prev => ({ ...prev, type: ["Deficiency type must be selected."] }));
             setIsLoading(false);
             return;
        }

        try {
            const response = await fetch('/api/deficiencies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    borrowId,
                    userId, // Send selected ID
                    type: type,
                    description: description || undefined,
                    ficToNotifyId: ficToNotifyId || undefined, // Send selected ID or undefined
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                 if (response.status === 400 && result.errors) {
                    setErrors(result.errors);
                 }
                throw new Error(result.message || 'Failed to create deficiency');
            }

            toast.success('Deficiency created successfully!');
            // Reset form
            setBorrowId('');
            setUserId(undefined);
            setType(undefined);
            setDescription('');
            setFicToNotifyId(undefined);

        } catch (err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred";
            toast.error(message);
            console.error("Create Deficiency Error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Add Log ---
    console.log("[CreateDeficiencyForm] Rendering. Current 'type' state:", type);
    // --- Add Log for Enum Values --- 
    console.log("[CreateDeficiencyForm] DeficiencyType values array:", Object.values(DeficiencyType));

    return (
        <Card className="max-w-2xl bg-card/60 border-border/40">
            <CardHeader>
                <CardTitle>Log New Deficiency</CardTitle>
                <CardDescription>Enter details for the deficiency record. Fields marked with * are required.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Borrow ID */}
                    <div>
                        <Label htmlFor="borrowId">Borrow Record ID *</Label>
                        <Input 
                            id="borrowId" 
                            value={borrowId} 
                            onChange={(e) => setBorrowId(e.target.value)} 
                            placeholder="Enter the ID of the related borrow" 
                            required 
                        />
                        {errors.borrowId && <p className="text-xs text-destructive mt-1">{errors.borrowId.join(', ')}</p>}
                    </div>

                    {/* Responsible User ID (Combobox) */}
                    <div>
                        <Label htmlFor="userId">Responsible User (Student) *</Label>
                        <Combobox
                            items={regularUsers}
                            selectedValue={userId}
                            onSelectValue={setUserId}
                            placeholder="Select student..."
                            searchPlaceholder="Search students..."
                            loading={isLoadingUsers}
                            disabled={isLoadingUsers}
                            triggerId="userId"
                        />
                         {errors.userId && <p className="text-xs text-destructive mt-1">{errors.userId.join(', ')}</p>}
                    </div>

                    {/* Deficiency Type */}
                     <div>
                        <Label htmlFor="type">Deficiency Type *</Label>
                        <Select 
                            value={type} 
                            onValueChange={(value) => {
                                console.log("[CreateDeficiencyForm] Select onValueChange. Received value:", value);
                                const newType = value ? (value as DeficiencyType) : undefined;
                                console.log("[CreateDeficiencyForm] Setting type state to:", newType);
                                setType(newType); 
                            }} 
                        >
                            <SelectTrigger id="type">
                                <SelectValue placeholder="Select deficiency type" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(DeficiencyType).map((dtype) => {
                                    // Filter out potential non-string/empty values just in case
                                    if (typeof dtype !== 'string' || !dtype) {
                                      console.warn("[CreateDeficiencyForm] Skipping invalid DeficiencyType value:", dtype);
                                      return null;
                                    }
                                    return (
                                      <SelectItem key={dtype} value={dtype}>
                                          {dtype.replace('_', ' ')}
                                      </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                         {errors.type && <p className="text-xs text-destructive mt-1">{errors.type.join(', ')}</p>}
                    </div>

                    {/* Description */}
                    <div>
                        <Label htmlFor="description">Description</Label>
                        <Textarea 
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Provide details about the deficiency (optional)"
                        />
                         {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.join(', ')}</p>}
                    </div>

                    {/* FIC to Notify ID (Combobox) */}
                    <div>
                        <Label htmlFor="ficToNotifyId">FIC / Staff to Notify (Optional)</Label>
                         <Combobox
                            items={privilegedUsers}
                            selectedValue={ficToNotifyId}
                            onSelectValue={setFicToNotifyId}
                            placeholder="Select faculty/staff..."
                            searchPlaceholder="Search faculty/staff..."
                            loading={isLoadingUsers}
                            disabled={isLoadingUsers}
                            triggerId="ficToNotifyId"
                        />
                        {errors.ficToNotifyId && <p className="text-xs text-destructive mt-1">{errors.ficToNotifyId.join(', ')}</p>}
                    </div>

                    <Button type="submit" disabled={isLoading || isLoadingUsers} className="w-full">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isLoading ? 'Submitting...' : 'Create Deficiency Record'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

// --- Generic Combobox Component ---
interface ComboboxProps {
    items: UserSelectItem[];
    selectedValue?: string;
    onSelectValue: (value?: string) => void;
    placeholder: string;
    searchPlaceholder: string;
    loading?: boolean;
    disabled?: boolean;
    triggerId?: string;
}

function Combobox({ 
    items, selectedValue, onSelectValue, placeholder, searchPlaceholder, loading, disabled, triggerId 
}: ComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled || loading}
          id={triggerId}
        >
          {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : selectedValue ? (
              items.find((item) => item.value === selectedValue)?.label
          ) : (
              placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] max-h-[--radix-popover-content-available-height] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={item.label} // Search based on label
                    onSelect={(currentValueLabel) => {
                       // Find the actual value (ID) based on the selected label
                       const selectedItem = items.find(i => i.label.toLowerCase() === currentValueLabel.toLowerCase());
                       onSelectValue(selectedItem?.value); // Send back the ID
                       setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedValue === item.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              {/* Optional: Allow unselecting */}
                <CommandGroup>
                     <CommandItem 
                         value="--clear--" 
                         onSelect={() => { 
                             onSelectValue(undefined); 
                             setOpen(false); 
                         }}
                         className="text-xs text-muted-foreground italic"
                    >
                         (Clear Selection)
                     </CommandItem>
                </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Component to display the list of deficiencies
function DeficiencyList({ userRole }: { userRole: UserRole }) {
    const [deficiencies, setDeficiencies] = useState<DeficiencyAdminView[]>([]); 
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'UNRESOLVED' | 'RESOLVED'>('UNRESOLVED'); 
    const [isSubmittingAction, setIsSubmittingAction] = useState(false);
    // --- State for Details Modal ---
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedDeficiency, setSelectedDeficiency] = useState<DeficiencyAdminView | null>(null);

    // --- State for Delete Confirmation Dialog --- 
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deletingDeficiencyId, setDeletingDeficiencyId] = useState<string | null>(null);
    // -------------------------------------------

    const { data: session } = useSession(); // Get session data for token
    const token = session?.accessToken; // Access token

    const fetchDeficiencies = async (currentFilter: 'ALL' | 'UNRESOLVED' | 'RESOLVED') => { 
        setIsLoading(true);
        setError(null);
        let url = '/api/deficiencies';
        if (currentFilter !== 'ALL') {
            url += `?status=${currentFilter}`;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `Failed to fetch deficiencies (${response.status})`);
            }
            const data = await response.json();
            setDeficiencies(data as DeficiencyAdminView[]); 
        } catch (err) {
             const message = err instanceof Error ? err.message : "Could not load deficiencies";
             setError(message);
             console.error("Fetch Deficiencies Error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDeficiencies(filter);
    }, [filter]);

    const handleFilterChange = (newFilter: 'ALL' | 'UNRESOLVED' | 'RESOLVED') => {
        setFilter(newFilter);
    };

    const isPrivileged = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;

    // --- Filter columns based on user role --- 
    const displayedColumns = useMemo(() => {
        if (isPrivileged) {
            return allDeficiencyColumns; // Staff/Faculty see all columns
        } else {
            // Regular users do not see the column with id: 'actions'
            return allDeficiencyColumns.filter(column => column.id !== 'actions');
        }
    }, [isPrivileged]);

    const handleUpdateSuccess = () => {
        fetchDeficiencies(filter);
    };

    // Handler to Mark Deficiency as Resolved
    const handleResolveDeficiency = async (deficiencyId: string) => {
        console.log(`[handleResolveDeficiency] Attempting to resolve ID: ${deficiencyId}`); // Log start
        if (!deficiencyId || isSubmittingAction) {
            console.log(`[handleResolveDeficiency] Aborted: No ID or already submitting.`);
            return;
        }
        
        const resolutionNotes = prompt("Enter resolution notes (optional):");
        console.log(`[handleResolveDeficiency] Resolution notes: ${resolutionNotes}`);
        
        setIsSubmittingAction(true);
        try {
            console.log(`[handleResolveDeficiency] Sending PATCH request to /api/deficiencies/${deficiencyId}`);
            const response = await fetch(`/api/deficiencies/${deficiencyId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'RESOLVED', 
                    resolution: resolutionNotes || undefined 
                }), 
            });
            const result = await response.json();
            console.log(`[handleResolveDeficiency] Response status: ${response.status}, Response body:`, result);
            if (!response.ok) throw new Error(result.error || 'Failed to resolve deficiency');
            toast.success('Deficiency marked as resolved!');
            fetchDeficiencies(filter); // Refresh data
        } catch (error) { 
            console.error(`[handleResolveDeficiency] Failed for ID ${deficiencyId}:`, error);
            toast.error(error instanceof Error ? error.message : 'Failed to resolve deficiency.');
        } finally {
            console.log(`[handleResolveDeficiency] Finished for ID: ${deficiencyId}`);
            setIsSubmittingAction(false);
        }
    };

    // --- Modified handleDeleteDeficiency to open dialog ---
    const openDeleteConfirmation = (deficiencyId: string) => {
        setDeletingDeficiencyId(deficiencyId);
        setIsDeleteDialogOpen(true);
    };

    // --- Actual deficiency deletion logic (extracted and corrected) ---
    const performDeleteDeficiency = async () => {
        if (!deletingDeficiencyId) return;
        const deficiencyId = deletingDeficiencyId;
        
        // Check for token
        if (!token) {
            toast.error("Authentication token not found.");
            return;
        }

        setIsSubmittingAction(true);
        try {
            const response = await fetch(`/api/deficiencies/${deficiencyId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }, // Add Authorization header
            });

            if (!response.ok) {
                // Handle specific errors if possible
                if (response.status === 403) throw new Error("Permission denied.");
                const errorData = await response.json().catch(() => ({})); // Try to parse error
                throw new Error(errorData.message || 'Failed to delete deficiency record');
            }
            // No JSON body expected on successful DELETE (status 204 usually)
            toast.success("Deficiency record deleted successfully.");
            fetchDeficiencies(filter); // Refresh the list by re-fetching
            setIsDeleteDialogOpen(false); // Close dialog on success
            setDeletingDeficiencyId(null); // Clear the target ID
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete deficiency.");
            // Optionally keep dialog open on error
        } finally {
            setIsSubmittingAction(false);
        }
    };

    // --- NEW: Handler to Open Details Modal ---
    const handleOpenDetailsModal = (deficiencyId: string) => {
        const foundDeficiency = deficiencies.find(d => d.id === deficiencyId);
        if (foundDeficiency) {
            setSelectedDeficiency(foundDeficiency);
            setIsDetailsModalOpen(true);
        } else {
            toast.error("Could not find deficiency details.");
            console.error(`Deficiency not found in state: ${deficiencyId}`);
        }
    };
    // --- END NEW HANDLER ---

    return (
         <Card className="bg-card/60 border-border/40 mt-6">
            <CardHeader className="flex-row justify-between items-center">
                <div>
                    <CardTitle>Deficiency Records</CardTitle>
                    <CardDescription>View and manage existing deficiency records.</CardDescription>
                </div>
                <div className='flex items-center gap-2'>
                     <Button variant={filter === 'UNRESOLVED' ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('UNRESOLVED')}>Unresolved</Button>
                     <Button variant={filter === 'RESOLVED' ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('RESOLVED')}>Resolved</Button>
                     <Button variant={filter === 'ALL' ? 'default' : 'outline'} size="sm" onClick={() => handleFilterChange('ALL')}>All</Button>
                     <Button variant="ghost" size="icon" onClick={() => fetchDeficiencies(filter)} disabled={isLoading} title="Refresh List">
                         <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading && <LoadingSpinner />}
                {error && <p className="text-destructive text-center p-4 flex items-center justify-center"><AlertCircle className="mr-2 h-4 w-4"/>{error}</p>}
                {!isLoading && !error && deficiencies.length > 0 && (
                    <DataTable 
                        columns={displayedColumns} 
                        data={deficiencies} 
                        meta={{
                            resolveDeficiencyHandler: isPrivileged ? handleResolveDeficiency : undefined,
                            deleteDeficiencyHandler: isPrivileged ? openDeleteConfirmation : undefined,
                            openDetailsModalHandler: handleOpenDetailsModal,
                            isSubmittingAction: isSubmittingAction,
                        }}
                    />
                )}
            </CardContent>
             {/* Render the Details Modal */} 
             <DeficiencyDetailsModal 
                 isOpen={isDetailsModalOpen}
                 onOpenChange={setIsDetailsModalOpen}
                 deficiency={selectedDeficiency}
            />

            {/* --- Delete Deficiency Confirmation Dialog --- */} 
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action will permanently delete deficiency record 
                            <strong>ID: {deletingDeficiencyId}</strong>. 
                            This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmittingAction}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={performDeleteDeficiency}
                            disabled={isSubmittingAction}
                            className="bg-destructive hover:bg-destructive/90"
                        >
                            {isSubmittingAction ? <LoadingSpinner size="sm" className="mr-2" /> : null}
                            Confirm Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {/* --- End Delete Deficiency Dialog --- */}
        </Card>
    );
}

export default function DeficienciesPage() {
  const { data: session, status } = useSession();
  const userRole = session?.user?.role as UserRole;
  const isStaff = userRole === UserRole.STAFF;

  if (status === 'loading') {
    return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Deficiencies</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-8 space-y-6 lg:space-y-0">
          
          {isStaff && (
            <div className="lg:col-span-1">
                <CreateDeficiencyForm />
            </div>
          )}

          {status === 'authenticated' && userRole && (
              <div className={isStaff ? "lg:col-span-2" : "lg:col-span-3"}>
                 <DeficiencyList userRole={userRole} />
              </div>
          )}
      </div>

    </div>
  );
} 