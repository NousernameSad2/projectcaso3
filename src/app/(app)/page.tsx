'use client'; // Make client component again

import React, { useEffect, useState, useCallback, useMemo } from 'react'; // Import useEffect, useState, useMemo, useCallback
import { useSession } from 'next-auth/react'; // Import useSession
import { UserRole } from '@prisma/client'; // Import UserRole
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"; // Keep Card for layout
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  ClipboardList,   // For Borrows
  TriangleAlert,   // For Deficiencies
  PlusCircle,      // For New Reservation
  ListChecks,      // Icon for pending approvals
  AlertCircle,      // Icon for errors
  Loader2,
  PackageCheck,    // Added
  CheckCircle,     // Add CheckCircle
  AlertTriangle,    // Ensure this is imported
  Activity,
  Users,
  Package,
  Check,
  X,
} from 'lucide-react'; // Keep icons for layout
import LoadingSpinner from '@/components/ui/LoadingSpinner'; // Import a loading spinner
import { 
    BorrowStatus as PrismaBorrowStatus, 
    EquipmentStatus, // <<< Import EquipmentStatus
    Prisma // Import Prisma namespace
} from '@prisma/client'; 
import { ReservationType } from '@prisma/client'; // <<< Import ReservationType
import { format, isValid, differenceInHours } from 'date-fns'; // For date formatting and isValid
import { toast } from 'sonner'; // Import toast
import { transformGoogleDriveUrl } from '@/lib/utils'; // Added
import Image from 'next/image'; // Added
import { Badge } from "@/components/ui/badge"; // Added
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"; // Added for icon tooltips
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"; // Added Alert Dialog
import EditReservationModal from '@/components/dashboard/EditReservationModal'; // Corrected import path
import { useQueryClient } from '@tanstack/react-query'; // <<< ADDED: Import useQueryClient
import { useRouter } from 'next/navigation'; // <<< ADDED: Import useRouter (for potential navigation)

// --- TYPE DEFINITIONS ---

// Summary data type from API
interface DashboardSummary {
    "PENDING"?: number;
    "APPROVED"?: number;
    "ACTIVE"?: number;
    "OVERDUE"?: number;
    "PENDING_RETURN"?: number;
}

// Use Prisma.BorrowGetPayload to define the shape including relations
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const borrowWithRelations = Prisma.validator<Prisma.BorrowDefaultArgs>()({
  // include will fetch all scalar fields by default + the specified relations
  include: { 
    equipment: { select: { id: true, name: true, equipmentId: true, images: true, status: true } },
    borrower: { select: { id: true, name: true, email: true } },
    class: { select: { courseCode: true, section: true } }, // Include necessary class fields
    deficiencies: { select: { id: true } }, // ADDED deficiencies to the include
  }
});

// Define the type based on the payload
type PendingReservation = Prisma.BorrowGetPayload<typeof borrowWithRelations>;

// Helper functions (keep or import)
const getBorrowStatusVariant = (status: PrismaBorrowStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case PrismaBorrowStatus.PENDING: return "secondary";
    case PrismaBorrowStatus.APPROVED: return "default"; // Or maybe "outline"?
    case PrismaBorrowStatus.ACTIVE: return "success";
    case PrismaBorrowStatus.OVERDUE: return "destructive";
    case PrismaBorrowStatus.PENDING_RETURN: return "warning";
    case PrismaBorrowStatus.RETURNED: return "outline"; // Item received, pending checks
    case PrismaBorrowStatus.COMPLETED: return "success"; // Final state (might not be shown here)
    case PrismaBorrowStatus.REJECTED_FIC:
    case PrismaBorrowStatus.REJECTED_STAFF: return "destructive";
    case PrismaBorrowStatus.CANCELLED: return "default";
    default: return "default";
  }
};

const formatBorrowStatus = (status: PrismaBorrowStatus) => {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\\b\\w/g, l => l.toUpperCase()); // Capitalize each word
};

// <<< NEW: Helper functions for EquipmentStatus >>>
const getEquipmentStatusVariant = (status?: EquipmentStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  if (!status) return "default";
  switch (status) {
    case EquipmentStatus.AVAILABLE: return "success";
    case EquipmentStatus.BORROWED: return "secondary"; // Represents checked out
    case EquipmentStatus.RESERVED: return "default";   // Available but has upcoming reservation
    case EquipmentStatus.UNDER_MAINTENANCE: return "warning";
    // Use actual statuses from enum
    case EquipmentStatus.DEFECTIVE: return "destructive"; 
    case EquipmentStatus.OUT_OF_COMMISSION: return "destructive"; 
    default: return "default";
  }
};

const formatEquipmentStatus = (status?: EquipmentStatus): string => {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()); // Capitalize each word
};

// Helper function to safely format dates (copied from my-borrows)
const formatDateSafe = (dateInput: string | Date | null | undefined, formatString: string = 'PPp'): string => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  return isValid(date) ? format(date, formatString) : 'Invalid Date';
};

// <<< ADDED: Helper function to format reservation type >>>
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'IN CLASS' : 'OUT OF CLASS';
};

// Placeholder Panel Component (Can be moved to separate file later)
function StaffActionPanel() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  
  const [reservations, setReservations] = useState<PendingReservation[]>([]);
  const [isLoadingReservations, setIsLoadingReservations] = useState(true);
  const [reservationError, setReservationError] = useState<string | null>(null);
  
  const [returns, setReturns] = useState<PendingReservation[]>([]);
  const [isLoadingReturns, setIsLoadingReturns] = useState(true);
  const [returnError, setReturnError] = useState<string | null>(null);
  
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingGroupId, setProcessingGroupId] = useState<string | null>(null);
  const [editingReservation, setEditingReservation] = useState<PendingReservation | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [isRejectConfirmOpen, setIsRejectConfirmOpen] = useState(false);
  const [rejectTargetGroupId, setRejectTargetGroupId] = useState<string | null>(null);

  const [isRejectApprovedConfirmOpen, setIsRejectApprovedConfirmOpen] = useState(false);
  const [rejectApprovedTargetGroupId, setRejectApprovedTargetGroupId] = useState<string | null>(null);
  const [isRejectingApprovedGroupId, setIsRejectingApprovedGroupId] = useState<string | null>(null);

  // State for expanding sections
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [approvedExpanded, setApprovedExpanded] = useState(false);
  const [returnsExpanded, setReturnsExpanded] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(false);

  const INITIAL_ITEMS_LIMIT = 3; // Number of items to show initially

  const fetchReservations = useCallback(async () => {
    if (!session?.accessToken) return;
    setIsLoadingReservations(true);
    setReservationError(null);
    try {
      const response = await fetch('/api/borrows?status=PENDING&status=APPROVED&status=ACTIVE&status=OVERDUE', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) {
         const errorData = await response.json().catch(() => ({}));
         throw new Error(errorData.message || `Failed to fetch reservations (${response.status})`);
      }
      const data = await response.json();
      setReservations(data as PendingReservation[]);
    } catch (err) {
        const message = err instanceof Error ? err.message : "An unknown error occurred";
        setReservationError(message);
    } finally {
      setIsLoadingReservations(false);
    }
  }, [session?.accessToken]);
  
  const fetchReturns = useCallback(async () => {
    if (!session?.accessToken) return;
    setIsLoadingReturns(true);
    setReturnError(null);
    try {
      const response = await fetch('/api/borrows/pending-returns', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) {
         const errorData = await response.json().catch(() => ({}));
         throw new Error(errorData.message || `Failed to fetch pending returns (${response.status})`);
      }
      const data = await response.json();
      setReturns(data as PendingReservation[]);
    } catch (err) {
        const message = err instanceof Error ? err.message : "An unknown error occurred";
        setReturnError(message);
    } finally {
      setIsLoadingReturns(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (session?.accessToken) {
        fetchReservations();
        fetchReturns();
    }
  }, [session?.accessToken, fetchReservations, fetchReturns]);

  // Action Handlers (handleUpdateStatus, handleCheckout, etc. - unchanged)
  const handleUpdateStatus = async (borrowId: string, status: PrismaBorrowStatus) => {
     if (!session?.accessToken) { toast.error("Auth error."); return; }
     setProcessingId(borrowId);
     try {
         const response = await fetch(`/api/borrows/${borrowId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
            body: JSON.stringify({ status }),
         });
         const result = await response.json();
         if (!response.ok) { throw new Error(result.message || 'Failed to update status.'); }
         toast.success(`Reservation ${status === PrismaBorrowStatus.APPROVED ? 'approved' : 'rejected'} successfully.`);
         fetchReservations(); // Refresh list
     } catch (err) {
          const message = err instanceof Error ? err.message : "Update failed";
          toast.error(message);
     } finally {
        setProcessingId(null);
     }
  };
  const handleCheckout = async (borrowId: string) => {
     if (!session?.accessToken) { toast.error("Auth error."); return; }
     setProcessingId(borrowId);
     try {
         const response = await fetch(`/api/borrows/${borrowId}/checkout`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${session.accessToken}` }, // No body needed for checkout
         });
         const result = await response.json();
         if (!response.ok) { throw new Error(result.message || 'Checkout failed.'); }
         toast.success('Item checked out successfully.');
         fetchReservations(); // Refresh list
     } catch (err) {
          const message = err instanceof Error ? err.message : "Checkout error";
          toast.error(message);
     } finally {
        setProcessingId(null);
     }
  };
  const handleConfirmReturn = async (borrowId: string) => {
     if (!session?.accessToken) { toast.error("Auth error."); return; }
     setProcessingId(borrowId);
     try {
         const response = await fetch(`/api/borrows/${borrowId}/confirm-return`, {
            method: 'PATCH',
            headers: {
                 Authorization: `Bearer ${session.accessToken}`,
                 'Content-Type': 'application/json'
            },
            body: JSON.stringify({}) // Empty body
         });
         const result = await response.json();
         if (!response.ok) { throw new Error(result.message || 'Return confirmation failed.'); }
         toast.success('Return confirmed successfully.');
         fetchReturns(); // Refresh returns list
     } catch (err) {
          const message = err instanceof Error ? err.message : "Return confirmation error";
          toast.error(message);
     } finally {
        setProcessingId(null);
     }
  };

  const handleApproveGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId || processingGroupId || !session?.accessToken) return;
    setProcessingGroupId(borrowGroupId);
    try {
        const response = await fetch(`/api/borrows/bulk?groupId=${borrowGroupId}&action=approve`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${session.accessToken}` }
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || result.error || 'Failed to approve group.');
        }
        toast.success(result.message || "Group approved successfully!");

        // <<< ADDED: Invalidate cache for the specific group details
        await queryClient.invalidateQueries({ queryKey: ['borrowGroup', borrowGroupId] }); 
        // <<< ADDED: Also invalidate the dashboard list itself
        await queryClient.invalidateQueries({ queryKey: ['dashboardReservations'] }); // Assuming 'dashboardReservations' is a key used, adjust if needed
        await queryClient.invalidateQueries({ queryKey: ['pendingBorrows'] }); // Also invalidate pendingBorrows if that's used elsewhere

        // Refresh the local state list (can potentially be removed if using queryClient for dashboard list)
        fetchReservations(); 

        // Navigate to the group details page (as described by user)
        router.push(`/borrows/group/${borrowGroupId}`);

    } catch (error) {
        const message = error instanceof Error ? error.message : "Approval failed";
        console.error("Group Approval Error:", error);
        toast.error(`Approval failed: ${message}`);
    } 
    finally { setProcessingGroupId(null); }
  };
  const handleRejectGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId || processingGroupId || !session?.accessToken) return;

    // Set loading state using the existing pattern
    setProcessingGroupId(borrowGroupId);
    try {
      const response = await fetch(`/api/borrows/bulk/reject`, { // Send to the bulk endpoint
        method: 'POST', // Corrected method to POST
        headers: {
          'Authorization': `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ borrowGroupId: borrowGroupId }), // Corrected body structure
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to reject request group');

      // fetchReservations(); // Refresh list (already done in finally? Check original code)
      toast.success("Request group rejected successfully.");
      setReservations(prev => prev.filter(group => group.borrowGroupId !== borrowGroupId)); // Optimistic update

    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject request group.");
    } finally {
      setProcessingGroupId(null); // Clear loading state
      setIsRejectConfirmOpen(false); // Close dialog
      setRejectTargetGroupId(null); // Clear target
    }
  };
  const handleCheckoutGroup = async (borrowGroupId: string | null | undefined) => {
     if (!borrowGroupId || processingGroupId) return;
     setProcessingGroupId(borrowGroupId);
     try {
          console.log(`[Checkout Group Frontend] Sending PATCH to /api/borrows/bulk?groupId=${borrowGroupId}&action=checkout`); // Log before fetch
          const response = await fetch(`/api/borrows/bulk?groupId=${borrowGroupId}&action=checkout`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${session?.accessToken}` },
          });
          const result = await response.json();
          console.log(`[Checkout Group Frontend] API Response Status: ${response.status}`); 
          console.log(`[Checkout Group Frontend] API Response Body:`, result); 
          
          if (!response.ok) {
              console.error(`[Checkout Group Frontend] API call failed (status ${response.status}). Throwing error.`);
              throw new Error(result.message || result.error || 'Failed to checkout group.');
          }
          
          // --- Success Path --- 
          console.log("[Checkout Group Frontend] API call successful (response.ok). Showing success toast."); // Log before toast
          toast.success(result.message || `Successfully checked out ${result.count} items.`);
          
          // Temporarily comment out redirect to observe UI changes
          // router.push('/'); 
          
          // Refresh data AFTER success
          console.log("[Checkout Group Frontend] Calling fetchReservations() after successful checkout.");
          fetchReservations();

      } catch (err: unknown) {
          console.error("[Checkout Group Frontend] Checkout error caught:", err);
          const message = err instanceof Error ? err.message : "An unknown error occurred during group checkout.";
          toast.error(`Checkout failed: ${message}`);
    } finally {
          console.log("[Checkout Group Frontend] handleCheckoutGroup finally block. Setting processingGroupId=null."); // Updated log
          setProcessingGroupId(null); // Only set processingGroupId
      }
  };
  
  const handleConfirmReturnGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId || processingGroupId || !session?.accessToken) return;
    setProcessingGroupId(borrowGroupId);
    try {
        const response = await fetch(`/api/borrows/bulk/return`, {
            method: 'POST', // Changed to POST
            headers: {
                 Authorization: `Bearer ${session.accessToken}`,
                 'Content-Type': 'application/json' // Added Content-Type
            },
            body: JSON.stringify({ borrowGroupId }) // Send groupId in body
        });
        const result = await response.json();

        if (!response.ok) {
            // Use error field from result if available
            throw new Error(result.error || result.message || 'Failed to confirm group return.'); 
        }
        toast.success(result.message || `Successfully confirmed return for ${result.count} items.`);

        // Invalidate relevant queries
        await queryClient.invalidateQueries({ queryKey: ['pendingReturns'] }); // Key used for fetchReturns()
        await queryClient.invalidateQueries({ queryKey: ['dashboardReservations'] }); // Refresh main list
        await queryClient.invalidateQueries({ queryKey: ['borrowGroup', borrowGroupId] }); // Invalidate specific group if user navigates there

        // Manually trigger refetch of the returns list for immediate UI update
        // Note: fetchReturns needs to be accessible here or logic adjusted
        if (typeof fetchReturns === 'function') { 
            fetchReturns();
        } else {
            console.warn('fetchReturns function not available in this scope for StaffActionPanel');
             // Fallback: Invalidate query again hoping component re-renders and fetches
             await queryClient.invalidateQueries({ queryKey: ['pendingReturns'] });
        }

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "An unknown error occurred during group return confirmation.";
        toast.error(`Return confirmation failed: ${message}`);
    } finally {
        setProcessingGroupId(null);
    }
  };

  const performRejectApprovedGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId || isRejectingApprovedGroupId || !session?.accessToken) return;

    setIsRejectingApprovedGroupId(borrowGroupId);
    try {
      // Call the NEW API endpoint
      const response = await fetch(`/api/borrows/${borrowGroupId}/reject-approved`, { 
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        // No body needed, action is in the URL path
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to reject approved group');

      toast.success(data.message || "Approved group rejected successfully.");
      fetchReservations(); // Refresh the list to reflect the change

    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject approved group.");
    } finally {
      setIsRejectingApprovedGroupId(null); // Clear loading state
      setIsRejectApprovedConfirmOpen(false); // Close dialog
      setRejectApprovedTargetGroupId(null); // Clear target
    }
  };

  // --- Grouping Logic --- //
  const groupedPendingReservations = useMemo(() => {
    console.log("[Grouping Pending] Starting..."); // Added log
    const pending = reservations.filter(res => res.borrowStatus === PrismaBorrowStatus.PENDING);
    // Group by borrowGroupId (null/undefined groups are treated as individual requests)
    const groups: Record<string, PendingReservation[]> = {};
    pending.forEach(res => {
        const groupId = res.borrowGroupId || `individual-${res.id}`; // Use borrowId for grouping individuals
        console.log(`[Grouping Pending] Item ${res.id}, Original groupId: ${res.borrowGroupId}, Assigned Key: ${groupId}`); // Added log
        if (!groups[groupId]) {
            groups[groupId] = [];
        }
        groups[groupId].push(res);
    });
    console.log("[Grouping Pending] Final groups object:", groups); // Added log
    // Sort groups by the submission time of the first item in each group
    return Object.entries(groups).sort(([, itemsA], [, itemsB]) => 
        new Date(itemsA[0].requestSubmissionTime).getTime() - new Date(itemsB[0].requestSubmissionTime).getTime()
    );
  }, [reservations]);

  // Group Approved (Awaiting Checkout)
  const groupedApprovedReservations = useMemo(() => {
    console.log("[Grouping Approved] Starting..."); // Added log
    const approved = reservations.filter(res => res.borrowStatus === PrismaBorrowStatus.APPROVED);
    const groups: Record<string, PendingReservation[]> = {};
    approved.forEach(res => {
        const groupId = res.borrowGroupId || `individual-${res.id}`;
        console.log(`[Grouping Approved] Item ${res.id}, Original groupId: ${res.borrowGroupId}, Assigned Key: ${groupId}`); // Added log
        if (!groups[groupId]) {
            groups[groupId] = [];
        }
        groups[groupId].push(res);
    });
    console.log("[Grouping Approved] Final groups object:", groups); // Added log
    // Sort groups by the submission time of the first item in each group
    return Object.entries(groups).sort(([, itemsA], [, itemsB]) => 
        new Date(itemsA[0].requestSubmissionTime).getTime() - new Date(itemsB[0].requestSubmissionTime).getTime()
    );
  }, [reservations]);

  // Group Active Checkouts
  const groupedActiveCheckouts = useMemo(() => {
    console.log("[Grouping Active] Starting...");
    const activeAndOverdue = reservations.filter(
      res => res.borrowStatus === PrismaBorrowStatus.ACTIVE || res.borrowStatus === PrismaBorrowStatus.OVERDUE
    );
    const groups: Record<string, PendingReservation[]> = {};
    activeAndOverdue.forEach(res => {
        const groupId = res.borrowGroupId || `individual-${res.id}`;
        console.log(`[Grouping Active] Item ${res.id}, Original groupId: ${res.borrowGroupId}, Assigned Key: ${groupId}, Status: ${res.borrowStatus}`);
        if (!groups[groupId]) {
            groups[groupId] = [];
        }
        groups[groupId].push(res);
    });
    console.log("[Grouping Active] Final groups object:", groups);
    // Sort groups by checkout time (descending - newest first)
    return Object.entries(groups).sort(([, itemsA], [, itemsB]) =>
        new Date(itemsB[0].checkoutTime ?? 0).getTime() - new Date(itemsA[0].checkoutTime ?? 0).getTime()
    );
  }, [reservations]);

  // Group Pending Returns
  const groupedPendingReturns = useMemo(() => {
    console.log("[Grouping Returns] Starting...");
    const groups: Record<string, PendingReservation[]> = {}; // Reuse PendingReservation type
    returns.forEach(res => {
        const groupId = res.borrowGroupId || `individual-${res.id}`;
        console.log(`[Grouping Returns] Item ${res.id}, Original groupId: ${res.borrowGroupId}, Assigned Key: ${groupId}`);
        if (!groups[groupId]) {
            groups[groupId] = [];
        }
        groups[groupId].push(res);
    });
    console.log("[Grouping Returns] Final groups object:", groups);
    // Sort groups by when they were last updated (when return was requested) - oldest first
    return Object.entries(groups).sort(([, itemsA], [, itemsB]) =>
        new Date(itemsA[0].updatedAt).getTime() - new Date(itemsB[0].updatedAt).getTime()
    );
  }, [returns]);

  // Callback after successful edit
  const handleReservationEdited = () => {
      setIsEditModalOpen(false);
      setEditingReservation(null);
      fetchReservations(); // Refetch to show updated data
      toast.success("Reservation details updated.");
  };

  // Handler to open the rejection confirmation dialog (for PENDING requests)
  const openRejectConfirmation = (groupId: string) => {
      setRejectTargetGroupId(groupId);
      setIsRejectConfirmOpen(true);
  };

  // --- START: Handler to open REJECT APPROVED confirmation dialog ---
  const openRejectApprovedConfirmation = (groupId: string | null | undefined) => {
      if (!groupId) return;
      setRejectApprovedTargetGroupId(groupId);
      setIsRejectApprovedConfirmOpen(true);
  };
  // --- END: Handler to open REJECT APPROVED confirmation dialog ---

  // --- Rendering Logic --- //
  if (isLoadingReservations) { // Covers initial load for reservations part of the dashboard
    return <div className="p-4 text-center"><LoadingSpinner /> Loading dashboard data...</div>;
  }
  // Note: isLoadingReturns handles its own section's loading state

  if (reservationError) { // Main error for reservation-based sections
     return <div className="p-4 text-destructive">Error loading reservation data: {reservationError}</div>;
  }
  // Note: returnError handles its own section's error state

  const itemsToDisplayPending = pendingExpanded ? groupedPendingReservations : groupedPendingReservations.slice(0, INITIAL_ITEMS_LIMIT);
  const itemsToDisplayApproved = approvedExpanded ? groupedApprovedReservations : groupedApprovedReservations.slice(0, INITIAL_ITEMS_LIMIT);
  const itemsToDisplayReturns = returnsExpanded ? groupedPendingReturns : groupedPendingReturns.slice(0, INITIAL_ITEMS_LIMIT);
  const itemsToDisplayActive = activeExpanded ? groupedActiveCheckouts : groupedActiveCheckouts.slice(0, INITIAL_ITEMS_LIMIT);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Panel 1: Pending Reservations */}
        <div className="bg-card border border-border/30 rounded-lg shadow-sm p-4 flex flex-col">
          <h3 className="text-lg font-semibold text-foreground flex items-center mb-3">
              <ListChecks className="mr-2 h-5 w-5 text-yellow-500" />
              Pending Reservations
          </h3>
          {groupedPendingReservations.length === 0 ? (
              <p className="text-muted-foreground italic text-sm">No pending reservations.</p>
          ) : (
            <div className="flex-grow space-y-3"> {/* Use flex-grow to push button down if content is short */}
              {itemsToDisplayPending.map(([groupId, items]) => {
                  const isIndividual = groupId.startsWith('individual-');
                  const representativeItem = items[0]; 
                  const isProcessingThisGroup = processingGroupId === (isIndividual ? null : representativeItem.borrowGroupId);
                  const href = isIndividual ? `/equipment/${representativeItem.equipmentId}` : `/borrows/group/${representativeItem.borrowGroupId}`;
                  let isLateRequest = false;
                  let hoursDifference: number | null = null;
                  try {
                      if (representativeItem.requestedStartTime && representativeItem.requestSubmissionTime) {
                          const startTime = new Date(representativeItem.requestedStartTime);
                          const submissionTime = new Date(representativeItem.requestSubmissionTime);
                          if (isValid(startTime) && isValid(submissionTime)) {
                              hoursDifference = differenceInHours(startTime, submissionTime);
                              isLateRequest = hoursDifference < 48;
                          }
                      }
                  } catch (e) { console.error("Error calculating date difference:", e); }

                  return (
                      <Link href={href} key={groupId} className="block hover:bg-muted/10 transition-colors rounded-lg">
                          <Card className={`border rounded-lg overflow-hidden ${isProcessingThisGroup ? 'opacity-50' : ''}`}>
                              <CardHeader className="flex flex-row items-center justify-between bg-muted/30 px-4 py-3">
                                  <div>
                                      <CardTitle className="text-base font-medium flex items-center gap-2">
                                          {isIndividual ? <Package className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                                          <span>{representativeItem.borrower.name ?? 'Borrower'}</span>
                                          {!isIndividual && <span className="text-xs font-normal text-muted-foreground">({items.length} items)</span>}
                                          {hoursDifference !== null && (<Badge variant={isLateRequest ? "destructive" : "secondary"} className="ml-2 text-xs">{isLateRequest ? "Late Request" : "Regular Request"}</Badge>)}
                                          {representativeItem.reservationType && (<Badge variant={representativeItem.reservationType === 'IN_CLASS' ? 'success' : 'destructive'} className="ml-2 text-xs whitespace-nowrap">{formatReservationType(representativeItem.reservationType)}</Badge>)}
                                      </CardTitle>
                                      <CardDescription className="text-xs mt-1">Requested: {formatDateSafe(representativeItem.requestSubmissionTime, 'MMM d, yyyy h:mm a')}</CardDescription>
                                  </div>
                                  {!isIndividual && (
                                      <div className="flex gap-2">
                                          <Button size="sm" variant="outline" className="text-green-500 border-green-500/50 hover:bg-green-500/10 hover:text-green-600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleApproveGroup(representativeItem.borrowGroupId); }} disabled={isProcessingThisGroup} title="Approve Group">
                                              {isProcessingThisGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} <span className="ml-1 hidden sm:inline">Approve</span>
                                          </Button>
                                          <Button size="sm" variant="outline" className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRejectConfirmation(representativeItem.borrowGroupId!); }} disabled={isProcessingThisGroup} title="Reject Group">
                                              {isProcessingThisGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} <span className="ml-1 hidden sm:inline">Reject</span>
                                          </Button>
                                      </div>
                                  )}
                              </CardHeader>
                              <CardContent className="p-0">
                                  <ul className="divide-y divide-border">
                                      {items.map(item => (
                                          <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                                              <div className="flex items-center gap-3">
                                                  <Image 
                                                    src={transformGoogleDriveUrl(item.equipment?.images?.[0]) || '/images/placeholder-default.png'} 
                                                    alt={item.equipment?.name || 'Equipment'} 
                                                    width={40} 
                                                    height={40} 
                                                    className="rounded aspect-square object-cover" 
                                                    onError={(e) => {
                                                      if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                                        e.currentTarget.srcset = '/images/placeholder-default.png';
                                                        e.currentTarget.src = '/images/placeholder-default.png';
                                                      }
                                                    }}
                                                  />
                                                  <div><span className="font-medium">{item.equipment?.name || 'Unknown Equipment'}</span> <span className="text-xs text-muted-foreground ml-1">({item.equipment?.equipmentId || 'N/A'})</span></div>
                                              </div>
                                              <div className="text-xs text-muted-foreground text-right space-y-1">
                                                  <div>Req: {formatDateSafe(item.requestedStartTime)} - {formatDateSafe(item.requestedEndTime)}</div>
                                                  {item.class && <div className="text-[11px]">Class: {item.class.courseCode} S{item.class.section}</div>}
                                              </div>
                                              {isIndividual && (
                                                  <div className="flex gap-1">
                                                      <Button size="sm" variant="ghost" className="text-green-500 hover:bg-green-500/10" onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleUpdateStatus(item.id, PrismaBorrowStatus.APPROVED)}} disabled={processingId === item.id} title="Approve Item">{processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}</Button>
                                                      <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-500/10" onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleUpdateStatus(item.id, session?.user?.role === UserRole.FACULTY ? PrismaBorrowStatus.REJECTED_FIC : PrismaBorrowStatus.REJECTED_STAFF)}} disabled={processingId === item.id} title="Reject Item">{processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}</Button>
                                                  </div>
                                              )}
                                          </li>
                                      ))}
                                  </ul>
                              </CardContent>
                          </Card>
                      </Link>
                  );
              })}
            </div>
          )}
          {groupedPendingReservations.length > INITIAL_ITEMS_LIMIT && (
            <div className="mt-auto pt-2 text-center"> {/* mt-auto to push to bottom of flex container */}
              <Button variant="link" onClick={() => setPendingExpanded(!pendingExpanded)} className="text-sm">
                {pendingExpanded ? 'View Less' : 'View More'}
              </Button>
            </div>
          )}
        </div>

        {/* Panel 2: Approved (Awaiting Checkout) */}
        <div className="bg-card border border-border/30 rounded-lg shadow-sm p-4 flex flex-col">
          <h3 className="text-lg font-semibold text-foreground flex items-center mb-3">
             <PackageCheck className="mr-2 h-5 w-5 text-blue-500" /> 
             Approved (Awaiting Checkout)
         </h3>
          {groupedApprovedReservations.length === 0 ? (
              <p className="text-muted-foreground italic text-sm">No reservations awaiting checkout.</p>
          ) : (
            <div className="flex-grow space-y-3">
                  {itemsToDisplayApproved.map(([groupId, items]) => {
                      const isIndividual = groupId.startsWith('individual-');
                      const representativeItem = items[0]; 
                      const isProcessingThisGroup = processingGroupId === (isIndividual ? null : representativeItem.borrowGroupId);
                      const isRejectingThisApprovedGroup = isRejectingApprovedGroupId === (isIndividual ? null : representativeItem.borrowGroupId);
                      const href = isIndividual ? `/equipment/${representativeItem.equipmentId}` : `/borrows/group/${representativeItem.borrowGroupId}`;
                      return (
                          <Link href={href} key={groupId} className="block hover:bg-muted/10 transition-colors rounded-lg">
                              <Card className={`border rounded-lg overflow-hidden ${isProcessingThisGroup || isRejectingThisApprovedGroup ? 'opacity-50' : ''}`}>
                                  <CardHeader className="flex flex-row items-center justify-between bg-muted/30 px-4 py-3">
                                      <div>
                                          <CardTitle className="text-base font-medium flex items-center gap-2">
                                              {isIndividual ? <Package className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                                              <span>{representativeItem.borrower.name ?? 'Borrower'}</span>
                                              {!isIndividual && <span className="text-xs font-normal text-muted-foreground">({items.length} items)</span>}
                                               {representativeItem.reservationType && (<Badge variant={representativeItem.reservationType === 'IN_CLASS' ? 'success' : 'destructive'} className="ml-2 text-xs whitespace-nowrap">{formatReservationType(representativeItem.reservationType)}</Badge>)}
                                          </CardTitle>
                                          <CardDescription className="text-xs mt-1">Approved: {formatDateSafe(representativeItem.updatedAt, 'MMM d, yyyy h:mm a')}</CardDescription>
                                      </div>
                                      {!isIndividual && (
                                          <div className="flex gap-2">
                                               <Button size="sm" variant="outline" className="text-green-500 border-green-500/50 hover:bg-green-500/10 hover:text-green-600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCheckoutGroup(representativeItem.borrowGroupId); }} disabled={isProcessingThisGroup || isRejectingThisApprovedGroup} title="Checkout Group">
                                                  {isProcessingThisGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} <span className="ml-1 hidden sm:inline">Checkout</span>
                                              </Button>
                                              <Button size="sm" variant="outline" className="text-red-500 border-red-500/50 hover:bg-red-500/10 hover:text-red-600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRejectApprovedConfirmation(representativeItem.borrowGroupId); }} disabled={isProcessingThisGroup || isRejectingThisApprovedGroup} title="Reject Approved Group">
                                                  {isRejectingThisApprovedGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} <span className="ml-1 hidden sm:inline">Reject</span>
                                              </Button>
                                          </div>
                                      )}
                                  </CardHeader>
                                  <CardContent className="p-0">
                                      <ul className="divide-y divide-border">
                                          {items.map(item => (
                                              <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                                                   <div className="flex items-center gap-3">
                                                       <Image 
                                                         src={transformGoogleDriveUrl(item.equipment?.images?.[0]) || '/images/placeholder-default.png'} 
                                                         alt={item.equipment?.name || 'Equipment'} 
                                                         width={40} 
                                                         height={40} 
                                                         className="rounded aspect-square object-cover" 
                                                         onError={(e) => {
                                                           if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                                             e.currentTarget.srcset = '/images/placeholder-default.png';
                                                             e.currentTarget.src = '/images/placeholder-default.png';
                                                           }
                                                         }}
                                                       />
                                                       <div> <span className="font-medium">{item.equipment?.name || 'Unknown Equipment'}</span> <span className="text-xs text-muted-foreground ml-1">({item.equipment?.equipmentId || 'N/A'})</span></div>
                                                   </div>
                                                   <div className="text-xs text-muted-foreground text-right space-y-1">
                                                       <div>Approved: {formatDateSafe(item.approvedStartTime)} - {formatDateSafe(item.approvedEndTime)}</div>
                                                       {item.classId && item.class && <div className="text-[11px]">Class: {item.class.courseCode} S{item.class.section}</div>}
                                                   </div>
                                                  {isIndividual && (
                                                      <Button size="sm" variant="ghost" className="text-green-500 hover:bg-green-500/10" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCheckout(item.id); }} disabled={processingId === item.id || isProcessingThisGroup || isRejectingThisApprovedGroup} title="Checkout Item">
                                                          {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                      </Button>
                                                  )}
                                              </li>
                                          ))}
                                      </ul>
                                  </CardContent>
                              </Card>
                          </Link>
                      );
                  })}
            </div>
          )}
          {groupedApprovedReservations.length > INITIAL_ITEMS_LIMIT && (
            <div className="mt-auto pt-2 text-center">
              <Button variant="link" onClick={() => setApprovedExpanded(!approvedExpanded)} className="text-sm">
                {approvedExpanded ? 'View Less' : 'View More'}
              </Button>
            </div>
          )}
        </div>

        {/* Panel 3: Pending Returns */}
        <div className="bg-card border border-border/30 rounded-lg shadow-sm p-4 flex flex-col">
          <h3 className="text-lg font-semibold text-foreground flex items-center mb-3">
             <AlertTriangle className="mr-2 h-5 w-5 text-orange-500" /> 
             Pending Returns
         </h3>
          {isLoadingReturns && <div className="text-center py-4 flex-grow flex items-center justify-center"><LoadingSpinner /></div>}
          {returnError && <p className="text-destructive text-sm text-center py-4 flex-grow flex items-center justify-center">Error loading returns: {returnError}</p>}
          {!isLoadingReturns && !returnError && groupedPendingReturns.length === 0 && (
               <p className="text-muted-foreground italic text-sm flex-grow flex items-center justify-center">No items pending return confirmation.</p>
          )}
          {!isLoadingReturns && !returnError && groupedPendingReturns.length > 0 && (
            <>
              <div className="flex-grow space-y-3">
                  {itemsToDisplayReturns.map(([groupId, items]) => {
                      const isIndividual = groupId.startsWith('individual-');
                      const representativeItem = items[0]; 
                      const isProcessingThisGroup = processingGroupId === (isIndividual ? null : representativeItem.borrowGroupId);
                      const href = isIndividual ? `/equipment/${representativeItem.equipmentId}` : `/borrows/group/${representativeItem.borrowGroupId}`; 
                           return (
                               <Link href={href} key={groupId} className="block hover:shadow-lg transition-shadow duration-200 rounded-lg overflow-hidden">
                                   <Card className="bg-card/60 border border-border/30 hover:border-border/60 transition-colors overflow-hidden">
                                       <CardHeader className="p-4 bg-muted/30 border-b border-border/30">
                                           <div className="flex justify-between items-center gap-2">
                                               <div>
                                                   <CardTitle className="text-base font-medium flex items-center gap-2">
                                                       {isIndividual ? <Package className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                                                       {isIndividual ? "Individual Return" : `Group Return (${items.length} items)`}
                                                   </CardTitle>
                                                   <p className="text-xs text-muted-foreground">Borrowed by: {representativeItem.borrower.name || representativeItem.borrower.email}</p>
                                                   {representativeItem.reservationType && (<Badge variant={representativeItem.reservationType === 'IN_CLASS' ? 'success' : 'destructive'} className="ml-2 text-xs whitespace-nowrap">{formatReservationType(representativeItem.reservationType)}</Badge>)}
                                                   <p className="text-xs text-muted-foreground mt-1">Checked out: {formatDateSafe(representativeItem.checkoutTime)}</p>
                                                   <p className="text-xs text-muted-foreground">Approved Until: {formatDateSafe(representativeItem.approvedEndTime ?? null)}</p>
                                               </div>
                                               {!isIndividual && (
                                                   <Button size="sm" variant="outline" className="border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-600" onClick={(e) => { e.preventDefault(); handleConfirmReturnGroup(representativeItem.borrowGroupId); }} disabled={isProcessingThisGroup} title="Confirm Return for All Items in Group">
                                                       {isProcessingThisGroup ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Confirm Group Return
                                                   </Button>
                                               )}
                                           </div>
                                       </CardHeader>
                                       <CardContent className="p-0">
                                           <ul className="divide-y divide-border/30">
                                               {items.map((item: PendingReservation) => {
                                                   const hasOpenDeficiency = (item as PendingReservation).deficiencies && ((item as PendingReservation).deficiencies?.length ?? 0) > 0;
                                                   return (
                                                       <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                                                           <div className="flex items-center gap-3">
                                                               <Image 
                                                                 src={transformGoogleDriveUrl(item.equipment?.images?.[0]) || '/images/placeholder-default.png'} 
                                                                 alt={item.equipment?.name || 'Equipment'} 
                                                                 width={40} 
                                                                 height={40} 
                                                                 className="rounded aspect-square object-cover" 
                                                                 onError={(e) => {
                                                                   if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                                                     e.currentTarget.srcset = '/images/placeholder-default.png';
                                                                     e.currentTarget.src = '/images/placeholder-default.png';
                                                                   }
                                                                 }}
                                                               />
                                                               <div>
                                                                   <span className="font-medium text-foreground">{item.equipment?.name || 'Unknown Equipment'}</span> <span className="text-xs text-muted-foreground ml-1">({item.equipment?.equipmentId || 'N/A'})</span>
                                                                   <div className="inline-flex flex-wrap gap-1 ml-2">
                                                                     {hasOpenDeficiency && (<Badge variant="destructive" className="text-xs px-1.5 py-0.5 whitespace-nowrap">Deficiency</Badge>)}
                                                                     <Badge variant={getEquipmentStatusVariant(item.equipment?.status)} className="text-xs px-1.5 py-0.5 whitespace-nowrap">{formatEquipmentStatus(item.equipment?.status)}</Badge>
                                                                   </div>
                                                               </div>
                                                           </div>
                                                           <Button size="sm" variant='outline' className='border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-600' onClick={() => handleConfirmReturn(item.id)} disabled={processingId === item.id} title={`Confirm return for ${item.equipment?.name || 'Unknown Equipment'}`}>
                                                               {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Confirm Return
                                                           </Button>
                                                       </li>
                                                   );
                                               })}
                                           </ul>
                                       </CardContent>
                                   </Card>
                               </Link>
                           );
                       })}
              </div>
            </>
          )}
          {!isLoadingReturns && !returnError && groupedPendingReturns.length > INITIAL_ITEMS_LIMIT && (
            <div className="mt-auto pt-2 text-center">
              <Button variant="link" onClick={() => setReturnsExpanded(!returnsExpanded)} className="text-sm">
                {returnsExpanded ? 'View Less' : 'View More'}
              </Button>
            </div>
          )}
        </div>

        {/* Panel 4: Active Checkouts */}
        <div className="bg-card border border-border/30 rounded-lg shadow-sm p-4 flex flex-col">
          <h3 className="text-lg font-semibold text-foreground flex items-center mb-3">
             <Activity className="mr-2 h-5 w-5 text-green-500" /> 
             Active Checkouts
         </h3>
          {groupedActiveCheckouts.length === 0 ? (
              <p className="text-muted-foreground italic text-sm flex-grow flex items-center justify-center">No items currently checked out.</p>
          ) : (
            <>
              <div className="flex-grow space-y-3">
                  {itemsToDisplayActive.map(([groupId, items]: [string, PendingReservation[]]) => {
                      const isIndividual = groupId.startsWith('individual-');
                      const representativeItem = items[0]; 
                      const href = isIndividual ? `/equipment/${representativeItem.equipmentId}` : `/borrows/group/${representativeItem.borrowGroupId}`; 
                      const isGroupOverdue = items.some(item => item.borrowStatus === PrismaBorrowStatus.OVERDUE);
                      return (
                          <Link href={href} key={groupId} className="block hover:bg-muted/10 transition-colors rounded-lg">
                              <Card className="border rounded-lg overflow-hidden">
                                  <CardHeader className="flex flex-row items-center justify-between bg-muted/30 px-4 py-3">
                                      <div>
                                          <CardTitle className="text-base font-medium flex items-center gap-2">
                                              {isIndividual ? <Package className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                                              <span>{representativeItem.borrower.name ?? 'Borrower'}</span>
                                              {!isIndividual && <span className="text-xs font-normal text-muted-foreground">({items.length} items)</span>}
                                              {representativeItem.reservationType && (<Badge variant={representativeItem.reservationType === 'IN_CLASS' ? 'success' : 'destructive'} className="ml-2 text-xs whitespace-nowrap">{formatReservationType(representativeItem.reservationType)}</Badge>)}
                                              {isGroupOverdue && !isIndividual && (<Badge variant="destructive" className="ml-2 text-xs whitespace-nowrap">OVERDUE ITEMS</Badge>)}
                                          </CardTitle>
                                          <CardDescription className="text-xs mt-1">Checked out: {formatDateSafe(representativeItem.checkoutTime)} {representativeItem.approvedEndTime && ` | Expected Return: ${formatDateSafe(representativeItem.approvedEndTime)}`}</CardDescription>
                                      </div>
                                  </CardHeader>
                                   <CardContent className="p-0">
                                       <ul className="divide-y divide-border">
                                          {items.map((item: PendingReservation) => (
                                              <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                                                  <div className="flex items-center gap-3">
                                                      <Image 
                                                        src={transformGoogleDriveUrl(item.equipment?.images?.[0]) || '/images/placeholder-default.png'} 
                                                        alt={item.equipment?.name || 'Equipment'} 
                                                        width={40} 
                                                        height={40} 
                                                        className="rounded aspect-square object-cover" 
                                                        onError={(e) => {
                                                          if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                                            e.currentTarget.srcset = '/images/placeholder-default.png';
                                                            e.currentTarget.src = '/images/placeholder-default.png';
                                                          }
                                                        }}
                                                      />
                                                      <div>
                                                          <span className="font-medium text-foreground">{item.equipment?.name || 'Unknown Equipment'}</span> <span className="text-xs text-muted-foreground ml-1">({item.equipment?.equipmentId || 'N/A'})</span>
                                                          <Badge variant={getBorrowStatusVariant(item.borrowStatus)} className="ml-2 text-xs capitalize whitespace-nowrap">{formatBorrowStatus(item.borrowStatus)}</Badge>
                                                          <Badge variant={getEquipmentStatusVariant(item.equipment?.status)} className="ml-1 text-xs whitespace-nowrap">{formatEquipmentStatus(item.equipment?.status)}</Badge>
                                                      </div>
                                                  </div>
                                              </li>
                                          ))}
                                      </ul>
                                   </CardContent>
                              </Card>
                          </Link>
                      );
                  })}
              </div>
            </>
          )}
          {groupedActiveCheckouts.length > INITIAL_ITEMS_LIMIT && (
            <div className="mt-auto pt-2 text-center">
              <Button variant="link" onClick={() => setActiveExpanded(!activeExpanded)} className="text-sm">
                {activeExpanded ? 'View Less' : 'View More'}
              </Button>
            </div>
          )}
        </div>
      </div> {/* End of grid div */}

      {/* Dialogs remain outside the grid, but inside the main fragment */}
      <AlertDialog open={isRejectConfirmOpen} onOpenChange={setIsRejectConfirmOpen}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                      This action will reject all pending items associated with this transaction ID ({rejectTargetGroupId}). This cannot be undone.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel disabled={processingGroupId === rejectTargetGroupId}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleRejectGroup(rejectTargetGroupId)} disabled={processingGroupId === rejectTargetGroupId} className="bg-destructive hover:bg-destructive/90">
                      {processingGroupId === rejectTargetGroupId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm Reject
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      
      <AlertDialog open={isRejectApprovedConfirmOpen} onOpenChange={setIsRejectApprovedConfirmOpen}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                      This action will REJECT this already APPROVED group request ({rejectApprovedTargetGroupId}). Items will need to be requested again. This cannot be undone.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel disabled={!!isRejectingApprovedGroupId}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => performRejectApprovedGroup(rejectApprovedTargetGroupId)} disabled={!!isRejectingApprovedGroupId} className="bg-destructive hover:bg-destructive/90">
                      {isRejectingApprovedGroupId === rejectApprovedTargetGroupId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm Reject Approved
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      
      {editingReservation && (
          <EditReservationModal
              isOpen={isEditModalOpen}
              setIsOpen={setIsEditModalOpen}
              reservationData={editingReservation}
              onSuccess={handleReservationEdited}
          />
      )}
    </>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const userRole = user?.role as UserRole;
  const isPrivilegedUser = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;

  // --- STATE for Regular User Summary ---
  const [summaryData, setSummaryData] = useState<DashboardSummary>({});
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // --- NEW STATE for Deficiencies ---
  const [activeDeficiencyCount, setActiveDeficiencyCount] = useState<number | null>(null);
  const [isLoadingDeficiencies, setIsLoadingDeficiencies] = useState(false);
  const [deficiencyError, setDeficiencyError] = useState<string | null>(null);

  // const queryClient = useQueryClient(); // REMOVED
  // const router = useRouter(); // REMOVED

  // --- EFFECT for fetching summary data AND deficiencies --- 
   useEffect(() => {
    // Fetch summary only for non-privileged, authenticated users
    if (status === 'authenticated' && !isPrivilegedUser) {
        const fetchData = async () => {
            setIsLoadingSummary(true);
            setIsLoadingDeficiencies(true);
            setSummaryError(null);
            setDeficiencyError(null);
            
            try {
                // Fetch Summary
                const summaryResponse = await fetch('/api/users/dashboard-summary');
                if (!summaryResponse.ok) {
                    const errorData = await summaryResponse.json().catch(() => ({}));
                    throw new Error(errorData.message || `Failed to fetch summary (${summaryResponse.status})`);
                }
                const summaryJson: DashboardSummary = await summaryResponse.json();
                setSummaryData(summaryJson);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Could not load dashboard summary";
                console.error("Dashboard Summary Error:", err);
                setSummaryError(message);
                // Still try to load deficiencies even if summary fails
            } finally {
                setIsLoadingSummary(false);
            }

            try {
                // Fetch Unresolved Deficiencies
                const defResponse = await fetch('/api/deficiencies?status=UNRESOLVED');
                if (!defResponse.ok) {
                    const errorData = await defResponse.json().catch(() => ({}));
                    throw new Error(errorData.message || `Failed to fetch deficiencies (${defResponse.status})`);
                }
                const deficienciesJson: { id: string; description: string; status: string; type: string; }[] = await defResponse.json();
                setActiveDeficiencyCount(deficienciesJson.length); // Get the count
            } catch (err) {
                 const message = err instanceof Error ? err.message : "Could not load deficiencies";
                 console.error("Dashboard Deficiencies Error:", err);
                 setDeficiencyError(message);
            } finally {
                 setIsLoadingDeficiencies(false);
            }
        };
        fetchData();
    }
  }, [status, isPrivilegedUser]); // Rerun if auth status or role changes

  if (status === 'loading') {
    return (
        <div className="flex justify-center items-center min-h-[60vh]">
            <LoadingSpinner size="lg" />
        </div>
    );
  }

  return (
      <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
              {status === 'authenticated' && user ? (
                <p className="text-lg text-muted-foreground">
                  Welcome back, <span className="font-medium text-foreground">{user.name || user.email}</span>!
                </p>
              ) : (
                <p className="text-lg text-muted-foreground">
                  Welcome! Please log in.
                </p>
              )}
            </div>
            <Button asChild size="lg">
               <Link href="/equipment" className="flex items-center gap-2" >
                 <PlusCircle className="h-5 w-5" /> New Reservation
               </Link>
            </Button>
          </div>
          {isPrivilegedUser && (
            <StaffActionPanel />
          )}
          {!isPrivilegedUser && status === 'authenticated' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {/* Card 1: Active Borrows */}
                <Card className="bg-card/80 border-border/60">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">My Current Borrows</CardTitle>
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                     {isLoadingSummary && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                     {summaryError && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertCircle className="h-6 w-6 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{summaryError}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                     )}
                     {!isLoadingSummary && !summaryError && (
                         <div className="text-2xl font-bold text-foreground">
                             {/* Display ACTIVE + OVERDUE counts */}
                             {(summaryData?.[PrismaBorrowStatus.ACTIVE] ?? 0) + (summaryData?.[PrismaBorrowStatus.OVERDUE] ?? 0)}
                         </div> 
                     )}
                     {!isLoadingSummary && (
                        <p className="text-xs text-muted-foreground">
                          Items currently checked out {summaryData?.[PrismaBorrowStatus.OVERDUE] ?? 0 > 0 ? `(${summaryData?.[PrismaBorrowStatus.OVERDUE]} overdue)` : ''}
                        </p>
                     )}
                  </CardContent>
                </Card>

                 {/* Card 2: Pending & Approved Reservations */}
                <Card className="bg-card/80 border-border/60">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">My Upcoming Reservations</CardTitle>
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                     {isLoadingSummary && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                     {summaryError && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertCircle className="h-6 w-6 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{summaryError}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                     )}
                     {!isLoadingSummary && !summaryError && (
                        <div className="text-2xl font-bold text-foreground">
                            {/* Display PENDING + APPROVED counts */}
                            {(summaryData?.[PrismaBorrowStatus.PENDING] ?? 0) + (summaryData?.[PrismaBorrowStatus.APPROVED] ?? 0)}
                        </div>
                     )}
                     {!isLoadingSummary && (
                        <p className="text-xs text-muted-foreground">
                          {`${summaryData?.[PrismaBorrowStatus.PENDING] ?? 0} pending, ${summaryData?.[PrismaBorrowStatus.APPROVED] ?? 0} approved`}
                        </p>
                     )}
                  </CardContent>
                </Card>

                 {/* Card 3: Deficiencies - UPDATED */}
                <Card className="bg-card/80 border-border/60">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">My Active Deficiencies</CardTitle>
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                     {isLoadingDeficiencies && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                     {deficiencyError && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertCircle className="h-6 w-6 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{deficiencyError}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                     )}
                     {!isLoadingDeficiencies && !deficiencyError && (
                        <div className="text-2xl font-bold text-destructive">
                            {/* Display count or 0 */}
                            {activeDeficiencyCount ?? 0} 
                        </div> 
                     )}
                    {!isLoadingDeficiencies && (
                      <p className="text-xs text-muted-foreground">
                        Unresolved issues requiring attention
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
           )}
      </div>
  );
}
