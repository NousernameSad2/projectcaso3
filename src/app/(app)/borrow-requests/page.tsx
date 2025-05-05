'use client';

import React, { useEffect, useState } from 'react';
import { toast } from "sonner";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { DataTable } from "@/components/ui/data-table";
import { columns, type BorrowRequestAdminView } from "./columns";
import ConfirmReturnModal from "@/components/borrow/ConfirmReturnModal";
import { DeficiencyType, BorrowStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ColumnFiltersState } from "@tanstack/react-table";

export default function BorrowRequestsPage() {
  const [requests, setRequests] = useState<BorrowRequestAdminView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false); // State for action loading
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  // State for Confirm Return Modal
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ borrowId: string; equipmentName: string } | null>(null);

  const fetchRequests = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/borrows/admin');
      if (!response.ok) {
         const errorData = await response.json().catch(() => ({ error: "Failed to parse error response" }));
         if (response.status === 401 || response.status === 403) {
             setError(errorData.error || "You do not have permission to view this page.");
             toast.error(errorData.error || "Access Denied");
         } else {
             throw new Error(errorData.error || `Failed to fetch borrow requests: ${response.statusText}`);
         }
      } else {
          const data: BorrowRequestAdminView[] = await response.json();
          setRequests(data);
      }
    } catch (err) {
      console.error("Error fetching borrow requests:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests(); // Initial fetch
  }, []);

  // --- Handler for Bulk Approve Action ---
  const handleApproveGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
       toast.error("Cannot approve: Missing Group ID.");
       return;
    }
    if (isSubmittingAction) return; // Prevent double clicks

    setIsSubmittingAction(true);
    try {
      const response = await fetch('/api/borrows/bulk/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowGroupId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to approve group (${response.status})`);
      }

      toast.success(result.message || "Group approved successfully!");
      fetchRequests(); // Refetch data to update the table

    } catch (error) {
      console.error(`Bulk approve failed for group ${borrowGroupId}:`, error);
      toast.error(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };
  // ------------------------------------

  // --- Handler for Bulk Reject Action ---
  const handleRejectGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot reject: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return; // Prevent double clicks

    // Optional: Add confirmation dialog here?

    setIsSubmittingAction(true);
    try {
      const response = await fetch('/api/borrows/bulk/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowGroupId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to reject group (${response.status})`);
      }

      toast.success(result.message || "Group rejected successfully!");
      fetchRequests(); // Refetch data

    } catch (error) {
      console.error(`Bulk reject failed for group ${borrowGroupId}:`, error);
      toast.error(error instanceof Error ? error.message : "Rejection failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };
  // ------------------------------------

  // --- Handler for Bulk Checkout Action ---
  const handleConfirmCheckoutGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot checkout: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return; // Prevent double clicks

    setIsSubmittingAction(true);
    try {
      const response = await fetch('/api/borrows/bulk/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowGroupId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to checkout group (${response.status})`);
      }

      toast.success(result.message || "Group checked out successfully!");
      fetchRequests(); // Refetch data

    } catch (error) {
      console.error(`Bulk checkout failed for group ${borrowGroupId}:`, error);
      toast.error(error instanceof Error ? error.message : "Checkout failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };
  // ------------------------------------

  // --- Handler for Bulk Return Action ---
  const handleConfirmReturnGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot confirm return: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return; // Prevent double clicks

    // Optional: Add confirmation dialog here?

    setIsSubmittingAction(true);
    try {
      const response = await fetch('/api/borrows/bulk/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowGroupId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to confirm group return (${response.status})`);
      }

      toast.success(result.message || "Group return confirmed successfully!");
      fetchRequests(); // Refetch data

    } catch (error) {
      console.error(`Bulk return failed for group ${borrowGroupId}:`, error);
      toast.error(error instanceof Error ? error.message : "Return confirmation failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };
  // ------------------------------------

  // --- Modified Handler to OPEN the Confirm Return Modal ---
  const openConfirmReturnModal = (borrowRequest: BorrowRequestAdminView | null | undefined) => {
    if (!borrowRequest?.id) {
      toast.error("Cannot confirm return: Missing Borrow Request info.");
      return;
    }
    setReturnTarget({ borrowId: borrowRequest.id, equipmentName: borrowRequest.equipment.name });
    setIsReturnModalOpen(true);
  };

  // --- Handler to SUBMIT the Confirm Return API call (called by modal) ---
  const submitReturnConfirmation = async (returnData: { 
      returnCondition?: string; 
      returnRemarks?: string; 
      logDeficiency?: boolean; 
      deficiencyType?: DeficiencyType;
      deficiencyDescription?: string;
   }) => {
    if (!returnTarget || isSubmittingAction) return;
    
    const { borrowId } = returnTarget;
    setIsSubmittingAction(true);

    try {
      // Call Confirm Return API
      const confirmResponse = await fetch(`/api/borrows/${borrowId}/confirm-return`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            returnCondition: returnData.returnCondition,
            returnRemarks: returnData.returnRemarks
         }), 
      });

      const confirmResult = await confirmResponse.json();
      if (!confirmResponse.ok) {
        throw new Error(confirmResult.error || `Failed to confirm return (${confirmResponse.status})`);
      }
      toast.success(confirmResult.message || "Item return confirmed successfully!");

      // --- Log Deficiency if requested --- 
      if (returnData.logDeficiency && returnData.deficiencyType) {
         console.log("Logging deficiency:", { borrowId, type: returnData.deficiencyType, description: returnData.deficiencyDescription });
         try {
           const deficiencyResponse = await fetch('/api/deficiencies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                 borrowId: borrowId,
                 type: returnData.deficiencyType,
                 description: returnData.deficiencyDescription,
              }),
           });
           const deficiencyResult = await deficiencyResponse.json();
           if (!deficiencyResponse.ok) {
              // Log error but don't necessarily fail the whole process if return was confirmed
              console.error("Failed to log deficiency:", deficiencyResult.error);
              toast.error(`Return confirmed, but failed to log deficiency: ${deficiencyResult.error || 'Unknown error'}`);
           } else {
              toast.info("Deficiency logged successfully.");
           }
         } catch (deficiencyError) {
             console.error("Error submitting deficiency log:", deficiencyError);
             toast.error("Return confirmed, but encountered an error logging the deficiency.");
         }
      }
      // --- End Deficiency Logging --- 

      setIsReturnModalOpen(false); // Close modal only on success
      setReturnTarget(null);
      fetchRequests(); // Refetch data

    } catch (error) {
      console.error(`Confirm return process failed for borrow ${borrowId}:`, error);
      toast.error(error instanceof Error ? error.message : "Confirmation process failed.");
      // Keep modal open on error
    } finally {
      setIsSubmittingAction(false);
    }
  };
  // ---------------------------------------

  // --- Handler for Individual Item Approve ---
  const handleApproveItem = async (borrowId: string | null | undefined) => {
     if (!borrowId) return toast.error("Missing Borrow ID.");
     if (isSubmittingAction) return;
     
     setIsSubmittingAction(true);
     try {
        const response = await fetch('/api/borrows/bulk/approve', { // Uses the modified bulk endpoint
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ borrowId }), // Pass individual borrowId
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to approve item');
        toast.success(`Borrow request ${borrowId} approved!`);
        fetchRequests();
     } catch (error) {
        console.error(`Failed to approve item ${borrowId}:`, error);
        toast.error(error instanceof Error ? error.message : 'Failed to approve item.');
     } finally {
        setIsSubmittingAction(false);
     }
  };
  
  // --- Handler for Individual Item Reject ---
  const handleRejectItem = async (borrowId: string | null | undefined) => {
     if (!borrowId) return toast.error("Missing Borrow ID.");
     if (isSubmittingAction) return;

     setIsSubmittingAction(true);
     try {
        const response = await fetch('/api/borrows/bulk/reject', { // Uses the modified bulk endpoint
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ borrowId }), // Pass individual borrowId
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to reject item');
        toast.success(`Borrow request ${borrowId} rejected!`);
        fetchRequests();
     } catch (error) {
        console.error(`Failed to reject item ${borrowId}:`, error);
        toast.error(error instanceof Error ? error.message : 'Failed to reject item.');
     } finally {
        setIsSubmittingAction(false);
     }
  };

  // Options for status filter
  const statusOptions = Object.values(BorrowStatus);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-white">Borrow Requests</h1>
        {/* Add filtering/action buttons here later */} 
      </div>
      {/* --- ADD FILTER CONTROLS --- */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by borrower..."
            // Use controlled component approach if needed, or directly manipulate table state if available
            // This example assumes you pass filters down or handle them locally
             onChange={(event) => {
               // Add type for filter item
               const currentFilters = columnFilters.filter((f: { id: string; value: unknown }) => f.id !== 'borrower.name');
               setColumnFilters([...currentFilters, { id: 'borrower.name', value: event.target.value }]);
             }}
            className="max-w-sm h-9"
          />
          <Select
            // Use undefined for empty selection
            value={columnFilters.find((f: { id: string; value: unknown }) => f.id === 'borrowStatus')?.value as string | undefined}
            onValueChange={(value) => {
              console.log("[BorrowRequests Filter] Status Select onValueChange. Received value:", value);
              const currentFilters = columnFilters.filter((f: { id: string; value: unknown }) => f.id !== 'borrowStatus');
              const newValue = value === '' ? undefined : value; // Convert empty string back to undefined
              console.log("[BorrowRequests Filter] Setting filter state to:", newValue);
              setColumnFilters([...currentFilters, { id: 'borrowStatus', value: newValue }]);
            }}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              {/* <SelectItem value="">All Statuses</SelectItem> */}
              {statusOptions.map((status) => {
                  // --- Add Log ---
                  console.log("[BorrowRequests Filter] Mapping BorrowStatus:", status);
                  // Filter out potential non-string/empty values
                  if (typeof status !== 'string' || !status) {
                      console.warn("[BorrowRequests Filter] Skipping invalid BorrowStatus value:", status);
                      return null;
                  }
                  return (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}
                    </SelectItem>
                  );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* --- END FILTER CONTROLS --- */}
      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <LoadingSpinner size="lg" />
        </div>
      )}
      {error && (
        <div className="text-center text-destructive py-10">
          <p>{error}</p>
        </div>
      )}
      {!isLoading && !error && (
         <DataTable 
            columns={columns} 
            data={requests} 
            // Pass columnFilters state down if DataTable expects it, or let DataTable manage internally
            // This assumes DataTable now expects external filter state management
            // columnFilters={columnFilters} // Example: If DataTable needs it passed
            // onColumnFiltersChange={setColumnFilters} // Example: If DataTable needs handler
            meta={{
               // Group handlers
               approveGroupHandler: handleApproveGroup,
               rejectGroupHandler: handleRejectGroup,
               confirmCheckoutGroupHandler: handleConfirmCheckoutGroup,
               confirmReturnGroupHandler: handleConfirmReturnGroup,
               // Individual handlers
               approveItemHandler: handleApproveItem, // Add individual approve
               rejectItemHandler: handleRejectItem, // Add individual reject
               openConfirmReturnModalHandler: openConfirmReturnModal, 
               // General state
               isSubmittingAction: isSubmittingAction,
            }}
         />
      )}
      {/* Render the Modal */}
      <ConfirmReturnModal
         isOpen={isReturnModalOpen}
         onOpenChange={setIsReturnModalOpen} // Control open state
         onSubmit={submitReturnConfirmation} // Pass the API call submit handler
         isSubmitting={isSubmittingAction}
         borrowId={returnTarget?.borrowId ?? null}
         equipmentName={returnTarget?.equipmentName}
      />
    </div>
  );
} 