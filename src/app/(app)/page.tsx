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
  FileText,
  Download,
  Database,
  Mail, // <<< ADDED for email button
  Trash2, // Added for cancel button
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
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'; // <<< MODIFIED: Import useQuery, useMutation as well
import { useRouter } from 'next/navigation'; // <<< ADDED: Import useRouter (for potential navigation)
import { ChevronUp, ChevronDown } from 'lucide-react'; // <<< ADDED for new component
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"; // Added for status update

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

// <<< REVISED: Type definition for Admin's view of data requests >>>
// This interface defines the expected shape for items in the admin data request panel.
// It assumes the API returns 'equipment' as an array of relevant equipment details.

interface EquipmentDetailForDataRequest {
  id: string;
  name: string | null;
  equipmentId: string | null;
  isDataGenerating: boolean;
  images?: string[] | null; // Optional: if needed for display within the list
}

interface AdminDataRequestItem {
  // Fields from Borrow model (or tailored for data request view)
  id: string;
  dataRequested: boolean | null;
  dataRequestRemarks: string | null;
  dataRequestStatus: string | null;
  dataFiles: { name: string; url: string; type?: string; size?: number }[] | null;
  requestedEquipmentIds: string[] | null; // IDs of equipment for which data was requested
  
  // Timestamps - ensure consistency with API (Date or string)
  // Prisma returns Date, JSON stringifies. formatDateSafe handles both.
  updatedAt: Date | string; 
  requestedStartTime: Date | string;
  requestedEndTime: Date | string;
  
  // Status and grouping
  borrowStatus?: PrismaBorrowStatus; // Optional, if needed from original borrow record
  borrowGroupId?: string | null;    // Optional

  // Included/Joined data
  borrower: {
    id: string; // Make sure API provides this if used for keys or links
    name: string | null;
    email: string | null;
  };
  
  // Primary equipment associated with the borrow record (like in DataRequestAdminView)
  equipment: {
    id: string;
    name: string | null;
    equipmentId: string | null;
    // isDataGenerating?: boolean; // This can be fetched if needed for the primary equipment
    // images?: string[] | null;
  } | null; 
  
  // Detailed list of equipment items for which data was specifically requested
  detailedRequestedEquipment: EquipmentDetailForDataRequest[]; 

  // Optional: class details if relevant and provided by API
  class?: { 
    courseCode: string; 
    section: string; 
  } | null;
}
// <<< END REVISED >>>

// <<< ADDED: Type definition for user's data requests >>>
interface UserDataRequest {
  id: string;
  equipment: {
    name: string | null;
    equipmentId: string | null;
    images: string[] | null;
  };
  dataRequestRemarks: string | null;
  dataRequestStatus: string | null;
  dataFiles: { name: string; url: string; type?: string; size?: number }[] | null; // Adjusted to match admin view, but URL is key
  updatedAt: string; // For sorting or display
  requestedStartTime: string; // For context
  requestedEndTime: string; // For context
}
// <<< END ADDED >>>

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
                                                       <div>
                                                           <span className="font-medium">{item.equipment?.name || 'Unknown Equipment'}</span> <span className="text-xs text-muted-foreground ml-1">({item.equipment?.equipmentId || 'N/A'})</span>
                                                       </div>
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

// <<< NEW: AdminDataRequestsDashboardPanel component >>>
function AdminDataRequestsDashboardPanel() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [isFetchingGroupMatesAdmin, setIsFetchingGroupMatesAdmin] = useState(false);

  const {
    data: adminDataRequests,
    isLoading: isLoadingDataRequests,
    error: dataRequestsError,
    refetch: refetchAdminDataRequests, // Added for refetching
  } = useQuery<AdminDataRequestItem[], Error>({
    queryKey: ['adminDashboardDataRequests'],
    queryFn: async () => {
      if (!session?.accessToken) throw new Error('Not authenticated');
      const response = await fetch('/api/borrows/data-requests-detailed', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to fetch data requests for admin' }));
        throw new Error(errorData.message || `Server error: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!session?.accessToken,
  });

  const toggleExpandRequest = (requestId: string) => {
    setExpandedRequests(prev => {
      const newSet = new Set(prev);
      if (newSet.has(requestId)) {
        newSet.delete(requestId);
      } else {
        newSet.add(requestId);
      }
      return newSet;
    });
  };

  // Mutation for updating status
  const updateStatusMutation = useMutation<unknown, Error, { requestId: string; status: string }>({
    mutationFn: async ({ requestId, status }) => {
      if (!session?.accessToken) throw new Error('Not authenticated');
      const response = await fetch(`/api/borrows/data-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}` 
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to update status');
      }
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast.success(`Data request ${variables.requestId} status updated to ${variables.status}`);
      queryClient.invalidateQueries({ queryKey: ['adminDashboardDataRequests'] });
      queryClient.invalidateQueries({ queryKey: ['dataRequestsAdmin'] });
      refetchAdminDataRequests(); // Refetch this panel's data
    },
    onError: (error) => {
      toast.error(`Failed to update status: ${error.message}`);
    },
  });

  const handleUpdateStatus = (requestId: string, status: string) => {
    updateStatusMutation.mutate({ requestId, status });
  };

  // --- NEW: Mutation for Cancelling/Deleting Data Request (similar to borrow-requests page) ---
  const cancelDataRequestAdminMutation = useMutation<
    { message: string },
    Error,
    { requestId: string }
  >({
    mutationFn: async ({ requestId }) => {
      if (!session?.accessToken) throw new Error('Not authenticated');
      const response = await fetch(`/api/borrows/data-requests/${requestId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to cancel data request from admin panel');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message || "Data request cancelled successfully from admin panel!");
      refetchAdminDataRequests(); // Refetch this panel's data
      queryClient.invalidateQueries({ queryKey: ['dataRequestsAdmin'] }); // Invalidate other views
    },
    onError: (error) => {
      toast.error(`Error cancelling request from admin panel: ${error.message}`);
    },
  });

  const handleCancelDataRequestAdmin = (requestId: string, equipmentName: string | null | undefined) => {
    const requestNameToConfirm = equipmentName || `request ID ${requestId.substring(0, 8)}`;
    if (confirm(`Are you sure you want to cancel the data request for ${requestNameToConfirm} from the admin panel? This action cannot be undone.`)) {
      cancelDataRequestAdminMutation.mutate({ requestId });
    }
  };

  const fetchGroupmateEmailsAdmin = async (groupId: string): Promise<string[]> => {
    try {
      const response = await fetch(`/api/borrow-groups/${groupId}/member-emails`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch groupmate emails for admin panel');
      }
      return await response.json() as string[];
    } catch (error) {
      console.error("Error fetching groupmate emails for admin panel:", error);
      toast.error(error instanceof Error ? error.message : "Could not fetch groupmate emails.");
      return [];
    }
  };

  const handleEmailBorrowerAndGroupmatesAdmin = async (request: AdminDataRequestItem) => {
    let mailtoLink = `mailto:${request.borrower.email}`;
    if (request.borrowGroupId) {
      setIsFetchingGroupMatesAdmin(true);
      try {
        const groupEmails = await fetchGroupmateEmailsAdmin(request.borrowGroupId);
        const ccEmails = groupEmails.filter(email => email && email !== request.borrower.email).join(',');
        if (ccEmails) {
          mailtoLink += `?cc=${ccEmails}`;
        }
      } finally {
        setIsFetchingGroupMatesAdmin(false);
      }
    }
    window.location.href = mailtoLink;
  };

  // const pendingDataRequests = adminDataRequests?.filter(req => req.dataRequestStatus === 'Pending') || [];
  // const otherDataRequests = adminDataRequests?.filter(req => req.dataRequestStatus !== 'Pending').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) || [];
  
  // NEW Filtering Logic for Admin Dashboard
  const nonFulfilledRequests = adminDataRequests
    ?.filter(req => req.dataRequestStatus !== 'Fulfilled')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) || [];

  const fulfilledRequests = adminDataRequests
    ?.filter(req => req.dataRequestStatus === 'Fulfilled')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) || [];

  return (
    <Card className="mt-6 bg-card/90 border-border/40 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center text-xl">
            <Database className="mr-3 h-6 w-6 text-purple-400" />
            Manage Data Requests
        </CardTitle>
        <CardDescription>Review data requests, manage files, and update statuses. Sorted by last update.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingDataRequests && <div className="text-center py-8"><LoadingSpinner /><p className="text-muted-foreground mt-2">Loading data requests...</p></div>}
        {dataRequestsError && <div className="text-center py-8"><p className="text-destructive">Error: {dataRequestsError.message}</p></div>}
        
        {!isLoadingDataRequests && !dataRequestsError && (
          (nonFulfilledRequests.length === 0 && fulfilledRequests.length === 0) ? (
            <div className="text-center py-8">
              <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">No Data Requests Found</p>
              <p className="text-sm text-muted-foreground">There are currently no pending or processed data requests from users.</p>
            </div>
          ) : (
            <div className="space-y-6"> {/* Main container for both sections */}
              {/* Section for Non-Fulfilled Requests (Displayed by default) */}
              {nonFulfilledRequests.length > 0 && (
                <div className="space-y-4">
                  {nonFulfilledRequests.map(request => (
                    <Card key={request.id} className="bg-card/70 border-border/40">
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg">
                              Data Request: {request.equipment?.name ? `${request.equipment.name} (${request.equipment.equipmentId || 'N/A'})` : `ID ${request.id.substring(0,8)}`}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Requested by: {request.borrower.name || request.borrower.email} on {formatDateSafe(request.updatedAt, 'PPp')}
                            </CardDescription>
                          </div>
                          <Badge variant={request.dataRequestStatus === 'Fulfilled' ? 'success' : (request.dataRequestStatus === 'Pending' ? 'warning' : 'secondary')}>
                            {request.dataRequestStatus || 'Unknown'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {request.dataRequestRemarks && (
                          <p className="text-sm p-3 bg-muted/50 rounded-md border border-dashed">
                            <span className="font-semibold">Remarks:</span> {request.dataRequestRemarks}
                          </p>
                        )}
                        {request.detailedRequestedEquipment && request.detailedRequestedEquipment.length > 0 && (
                          <div className="space-y-1">
                            <h4 className="text-sm font-medium">Specifically Requested Equipment for Data:</h4>
                            <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                              {request.detailedRequestedEquipment.map(eq => (
                                <li key={eq.id} className="text-foreground/90">
                                  {eq.name ? `${eq.name} (ID: ${eq.equipmentId})` : `Equipment ID: ${eq.id}`}
                                  {eq.isDataGenerating && <Badge variant="outline" className="ml-2 text-xs border-blue-500 text-blue-500">Data Gen</Badge>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Attached Files:</h4>
                          {request.dataFiles && request.dataFiles.length > 0 ? (
                            <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                              {request.dataFiles.map((file, index) => (
                                <li key={file.name || index} className="flex justify-between items-center">
                                  <span className="text-primary truncate max-w-xs flex items-center gap-1">
                                    <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name} className="hover:underline">
                                      {file.name || `File ${index + 1}`}
                                    </a>
                                    {file.size && <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>}
                                    {file.type && <Badge variant="outline" className="text-xs scale-90 font-normal">{file.type}</Badge>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No files uploaded yet.</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 pt-2 border-t border-border/20 mt-3">
                          <Select
                            value={request.dataRequestStatus || ''}
                            onValueChange={(newStatus) => handleUpdateStatus(request.id, newStatus)}
                            disabled={updateStatusMutation.isPending && updateStatusMutation.variables?.requestId === request.id}
                          >
                            <SelectTrigger className="w-[180px] h-9 text-xs">
                              <SelectValue placeholder="Update status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Pending">Pending</SelectItem>
                              <SelectItem value="Processing">Processing</SelectItem>
                              <SelectItem value="Fulfilled">Fulfilled</SelectItem>
                              <SelectItem value="Rejected">Rejected</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs"
                            onClick={() => handleEmailBorrowerAndGroupmatesAdmin(request)}
                            disabled={(updateStatusMutation.isPending && updateStatusMutation.variables?.requestId === request.id) || (cancelDataRequestAdminMutation.isPending && cancelDataRequestAdminMutation.variables?.requestId === request.id) || isFetchingGroupMatesAdmin}
                          >
                            {isFetchingGroupMatesAdmin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                            Email Borrower
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs text-destructive hover:border-destructive/70 hover:text-destructive"
                            onClick={() => handleCancelDataRequestAdmin(request.id, request.equipment?.name)}
                            disabled={(updateStatusMutation.isPending && updateStatusMutation.variables?.requestId === request.id) || (cancelDataRequestAdminMutation.isPending && cancelDataRequestAdminMutation.variables?.requestId === request.id) || (request.dataRequestStatus === 'Fulfilled' && (request.dataFiles?.length ?? 0) > 0)}
                          >
                            {(cancelDataRequestAdminMutation.isPending && cancelDataRequestAdminMutation.variables?.requestId === request.id) 
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                              : <Trash2 className="mr-2 h-4 w-4" />}
                            Cancel Request
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Section for Fulfilled Requests (Collapsible) */}
              {fulfilledRequests.length > 0 && (
                <div>
                  <Button variant="link" onClick={() => toggleExpandRequest('fulfilledAdminRequests')} className="text-md font-semibold mb-2 px-0 text-muted-foreground hover:text-foreground">
                    Fulfilled Data Requests ({fulfilledRequests.length})
                    {expandedRequests.has('fulfilledAdminRequests') ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                  </Button>
                  {expandedRequests.has('fulfilledAdminRequests') && (
                    <div className="space-y-4 pt-2 border-t border-border/30">
                      {fulfilledRequests.map(request => (
                        <Card key={request.id} className="bg-card/70 border-border/40"> {/* Consistent styling */}
                          <CardHeader>
                            <div className="flex justify-between items-start">
                              <div>
                                <CardTitle className="text-lg">
                                  Data Request: {request.equipment?.name ? `${request.equipment.name} (${request.equipment.equipmentId || 'N/A'})` : `ID ${request.id.substring(0,8)}`}
                                </CardTitle>
                                <CardDescription className="text-xs">
                                  Requested by: {request.borrower.name || request.borrower.email} on {formatDateSafe(request.updatedAt, 'PPp')}
                                </CardDescription>
                              </div>
                              <Badge variant={'success'}> {/* Always success for this section */}
                                {request.dataRequestStatus || 'Fulfilled'}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {request.dataRequestRemarks && (
                              <p className="text-sm p-3 bg-muted/50 rounded-md border border-dashed">
                                <span className="font-semibold">Remarks:</span> {request.dataRequestRemarks}
                              </p>
                            )}
                            {request.detailedRequestedEquipment && request.detailedRequestedEquipment.length > 0 && (
                              <div className="space-y-1">
                                <h4 className="text-sm font-medium">Specifically Requested Equipment for Data:</h4>
                                <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                                  {request.detailedRequestedEquipment.map(eq => (
                                    <li key={eq.id} className="text-foreground/90">
                                      {eq.name ? `${eq.name} (ID: ${eq.equipmentId})` : `Equipment ID: ${eq.id}`}
                                      {eq.isDataGenerating && <Badge variant="outline" className="ml-2 text-xs border-blue-500 text-blue-500">Data Gen</Badge>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="space-y-2">
                              <h4 className="text-sm font-medium">Attached Files:</h4>
                              {request.dataFiles && request.dataFiles.length > 0 ? (
                                <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                                  {request.dataFiles.map((file, index) => (
                                    <li key={file.name || index} className="flex justify-between items-center">
                                      <span className="text-primary truncate max-w-xs flex items-center gap-1">
                                        <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name} className="hover:underline">
                                          {file.name || `File ${index + 1}`}
                                        </a>
                                        {file.size && <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>}
                                        {file.type && <Badge variant="outline" className="text-xs scale-90 font-normal">{file.type}</Badge>}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">No files were uploaded for this fulfilled request.</p>
                              )}
                            </div>
                            {/* Action buttons are less relevant for already fulfilled items, could be omitted or simplified */}
                             <div className="flex items-center gap-2 pt-2 border-t border-border/20 mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs"
                                  onClick={() => handleEmailBorrowerAndGroupmatesAdmin(request)}
                                  disabled={isFetchingGroupMatesAdmin} /* Only disable if fetching emails */
                                >
                                  {isFetchingGroupMatesAdmin && (cancelDataRequestAdminMutation.variables?.requestId === request.id || updateStatusMutation.variables?.requestId === request.id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                                  Email Borrower
                                </Button>
                                {/* Optionally, a 'Re-open' or 'Archive' button could go here if needed in future */}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
// <<< END NEW >>>

// <<< ADDED: UserDataRequestsPanel component >>>
function UserDataRequestsPanel() {
  const { data: session } = useSession();
  const { 
    data: dataRequests, 
    isLoading, 
    error 
  } = useQuery<UserDataRequest[], Error>({
    queryKey: ['userDataRequests'],
    queryFn: async () => {
      if (!session?.accessToken) {
        throw new Error('Not authenticated');
      }
      const response = await fetch('/api/users/me/data-requests', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to fetch data requests' }));
        throw new Error(errorData.message || `Server error: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!session?.accessToken, // Only run if session exists
  });

  if (isLoading) {
    return (
      <Card className="mt-6 bg-card/80 border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <Database className="mr-2 h-5 w-5 text-blue-400" />
            My Data Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-2">Loading your data requests...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mt-6 bg-card/80 border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <Database className="mr-2 h-5 w-5 text-blue-400" />
            My Data Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Error loading data requests: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (!dataRequests || dataRequests.length === 0) {
    return (
      <Card className="mt-6 bg-card/80 border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <Database className="mr-2 h-5 w-5 text-blue-400" />
            My Data Requests
          </CardTitle>
           <CardDescription>View the status of data you requested during item returns.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-muted-foreground">You have not made any data requests yet.</p>
            <p className="text-xs text-muted-foreground mt-1">When you return an item and request data, it will appear here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 bg-card/80 border-border/60 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center text-xl">
          <Database className="mr-3 h-6 w-6 text-blue-400" />
          My Data Requests
        </CardTitle>
        <CardDescription>Track the status of your data requests and download available files.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {dataRequests.map((request) => (
            <Card key={request.id} className="bg-background/70 border-border/50 overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-4 p-4 bg-muted/30">
                <div>
                  <CardTitle className="text-md font-semibold flex items-center">
                     <Image 
                        src={transformGoogleDriveUrl(request.equipment?.images?.[0]) || '/images/placeholder-default.png'} 
                        alt={request.equipment?.name || 'Equipment'} 
                        width={24} 
                        height={24} 
                        className="rounded-sm aspect-square object-cover mr-2 border border-border/30"
                        onError={(e) => {
                          if (e.currentTarget.src !== '/images/placeholder-default.png') {
                            e.currentTarget.srcset = '/images/placeholder-default.png';
                            e.currentTarget.src = '/images/placeholder-default.png';
                          }
                        }}
                      />
                    {request.equipment?.name || 'Unknown Equipment'}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Equipment ID: {request.equipment?.equipmentId || 'N/A'} <br />
                    Borrow Period: {formatDateSafe(request.requestedStartTime, 'MMM d, yy')} - {formatDateSafe(request.requestedEndTime, 'MMM d, yy')}
                  </CardDescription>
                </div>
                <Badge 
                  variant={request.dataRequestStatus === 'Fulfilled' ? 'success' : request.dataRequestStatus === 'Pending' ? 'secondary' : 'outline'}
                  className="whitespace-nowrap text-xs"
                >
                  {request.dataRequestStatus || 'Status Unknown'}
                </Badge>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {request.dataRequestRemarks && (
                  <div className="text-sm">
                    <p className="font-medium text-muted-foreground">Your Remarks:</p>
                    <p className="p-2 bg-muted/50 rounded-md text-foreground/90 whitespace-pre-wrap">{request.dataRequestRemarks}</p>
                  </div>
                )}
                <div>
                  <p className="font-medium text-muted-foreground text-sm mb-1">Files:</p>
                  {request.dataFiles && request.dataFiles.length > 0 ? (
                    <ul className="space-y-2">
                      {request.dataFiles.map((file, index) => (
                        <li key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span>{file.name || `File ${index + 1}`}</span>
                            {file.size && <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>}
                            {file.type && <Badge variant="outline" className="text-xs ml-1">{file.type}</Badge>}
                          </div>
                          {request.dataRequestStatus === 'Fulfilled' && file.url ? (
                            <Button asChild variant="outline" size="sm" className="text-xs">
                              <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                                <Download className="mr-1 h-3 w-3" /> Download
                              </a>
                            </Button>
                          ) : (
                             <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="sm" className="text-xs" disabled>
                                            <Download className="mr-1 h-3 w-3" /> Download
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>File not available for download yet.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      {request.dataRequestStatus === 'Fulfilled' ? 'No files were uploaded for this request.' : 'No files available yet.'}
                    </p>
                  )}
                </div>
                 <p className="text-xs text-muted-foreground text-right pt-1">Last updated: {formatDateSafe(request.updatedAt, 'MMM d, yyyy h:mm a')}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
// <<< END ADDED >>>

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const user = session?.user;
  const userRole = user?.role as UserRole;
  const isPrivilegedUser = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;
  const queryClient = useQueryClient(); // For refetching queries

  // Autorefresh logic
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (sessionStatus === 'authenticated') {
        // Invalidate and refetch queries relevant to the dashboard
        // This is a generic approach. Specific queries can be targeted if known.
        queryClient.invalidateQueries(); 
        // Alternatively, if you have specific fetch functions like `fetchData` below
        // you might call them directly if they are accessible and handle their own state.
        // e.g., if fetchData is part of this component's scope:
        // fetchData(); // Assuming fetchData is defined in this component and fetches all necessary data.
        
        // If StaffActionPanel and UserDashboardPanel have their own data fetching,
        // they might need to be refetched or have their internal data invalidated.
        // For now, invalidating all queries is a broad but effective approach.
        console.log('Dashboard refreshed');
      }
    }, 5 * 60 * 1000); // 5 minutes in milliseconds

    return () => clearInterval(intervalId); // Cleanup interval on component unmount
  }, [sessionStatus, queryClient]);

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
    if (sessionStatus === 'authenticated' && !isPrivilegedUser) {
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
  }, [sessionStatus, isPrivilegedUser]); // Rerun if auth status or role changes

  if (sessionStatus === 'loading') {
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
              {sessionStatus === 'authenticated' && user ? (
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
          {!isPrivilegedUser && sessionStatus === 'authenticated' && (
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
           {/* <<< ADDED: Render UserDataRequestsPanel for non-privileged users >>> */}
          {!isPrivilegedUser && sessionStatus === 'authenticated' && <UserDataRequestsPanel />}
          {/* <<< END ADDED >>> */}

          {/* <<< ADDED: Render AdminDataRequestsDashboardPanel for privileged users >>> */}
          {isPrivilegedUser && sessionStatus === 'authenticated' && <AdminDataRequestsDashboardPanel />}
          {/* <<< END ADDED >>> */}
      </div>
  );
}
