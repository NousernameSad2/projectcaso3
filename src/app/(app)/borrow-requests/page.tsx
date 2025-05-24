'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { toast } from "sonner";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { DataTable } from "@/components/ui/data-table";
import { columns, type BorrowRequestAdminView } from "./columns";
import ConfirmReturnModal from "@/components/borrow/ConfirmReturnModal";
import { DeficiencyType, BorrowStatus, Borrow, Equipment, User, Class, ReservationType } from "@prisma/client";
// import { Input } from "@/components/ui/input"; 
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ColumnFiltersState } from "@tanstack/react-table";
import { useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, FileText, AlertCircle, Users, X, /* UploadCloud, */ Trash2, Mail } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { format, isValid } from 'date-fns';
import { transformGoogleDriveUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// --- Type Definitions ---
type GroupBorrowWithDetails = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images' | 'id'>;
    borrower: Pick<User, 'id' | 'name' | 'email'>;
    class: Pick<Class, 'id' | 'courseCode' | 'section'> | null;
    reservationType?: ReservationType | null;
};

interface GroupedGroupBorrows {
    [groupId: string]: GroupBorrowWithDetails[];
}

// --- NEW: Type Definitions for Data Requests ---
interface DataRequestAdminView {
  id: string;
  borrower: { id: string; name: string | null; email: string };
  equipment: { id: string; name: string; equipmentId: string | null } | null;
  requestSubmissionTime: string; // Or Date
  dataRequestRemarks: string | null;
  dataRequestStatus: string | null;
  dataFiles: { name: string; url: string; id: string; size?: number; type?: string }[]; // Assuming files have a name and URL, and an ID for deletion
  updatedAt: string; // Or Date, for sorting
  borrowGroupId?: string | null; // Added for group context
}

// --- Helper Functions (Consider moving to utils) ---
const getBorrowStatusVariant = (status: BorrowStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
   switch (status) {
    case BorrowStatus.PENDING: return "warning";
    case BorrowStatus.APPROVED: return "secondary";
    case BorrowStatus.ACTIVE: return "success";
    case BorrowStatus.PENDING_RETURN: return "secondary";
    case BorrowStatus.RETURNED: case BorrowStatus.COMPLETED: return "default";
    case BorrowStatus.REJECTED_FIC: case BorrowStatus.REJECTED_STAFF: case BorrowStatus.CANCELLED: return "destructive";
    case BorrowStatus.OVERDUE: return "destructive";
    default: return "default";
  } 
};
const formatBorrowStatus = (status: BorrowStatus): string => {
   return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
};
const formatDateSafe = (dateInput: string | Date | null | undefined, formatString: string = 'PPp'): string => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  return isValid(date) ? format(date, formatString) : 'Invalid Date';
};

// Helper for Reservation Type Display
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'IN CLASS' : 'OUT OF CLASS';
};

const getReservationTypeVariant = (type: ReservationType | null | undefined): "success" | "destructive" | "secondary" => {
    if (!type) return 'secondary';
    return type === 'IN_CLASS' ? 'success' : 'destructive';
};

// --- Fetch Functions ---
const fetchGroupBorrows = async (): Promise<GroupBorrowWithDetails[]> => {
    const response = await fetch('/api/borrows/groups');
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) return [];
        const errorData: { message?: string } = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch group borrows: ${response.statusText}`);
    }
    return await response.json() as GroupBorrowWithDetails[];
};

// --- NEW: Fetch Function for Data Requests ---
const fetchDataRequests = async (): Promise<DataRequestAdminView[]> => {
  const response = await fetch('/api/borrows/data-requests'); // New API endpoint
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return [];
    const errorData: { message?: string } = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch data requests: ${response.statusText}`);
  }
  return await response.json() as DataRequestAdminView[];
};

// --- Component --- 
export default function BorrowRequestsPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<BorrowRequestAdminView[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ borrowId: string; equipmentName: string } | null>(null);
  const [isFetchingGroupMates, setIsFetchingGroupMates] = useState(false); // For loading state

  // NEW STATE: To hold the file selected for upload for each request ID
  // const [filesToUpload, setFilesToUpload] = useState<{[key: string]: File | null}>({});

  const queryClient = useQueryClient();

  // --- NEW: Fetching Group Borrow Logs --- 
  const { 
      data: groupBorrowsData = [],
      isLoading: isLoadingGroupBorrows,
      error: groupBorrowsError,
  } = useQuery<GroupBorrowWithDetails[], Error>({
      queryKey: ['groupBorrowLogs'],
      queryFn: fetchGroupBorrows,
      enabled: status === 'authenticated',
      staleTime: 1000 * 60 * 2,
  });

  // --- NEW: Fetching Data Requests ---
  const {
    data: dataRequests = [],
    isLoading: isLoadingDataRequests,
    error: dataRequestsError,
    refetch: refetchDataRequests, // To refetch after updates
  } = useQuery<DataRequestAdminView[], Error>({
    queryKey: ['dataRequestsAdmin'],
    queryFn: fetchDataRequests,
    enabled: status === 'authenticated' && (session?.user?.role === UserRole.STAFF || session?.user?.role === UserRole.FACULTY), // Only for admins
    staleTime: 1000 * 60 * 1, // Refresh every minute
  });

  // --- NEW: Mutation for Updating Data Request Status ---
  const updateDataRequestStatusMutation = useMutation<
    DataRequestAdminView, // Expected response type
    Error, // Error type
    { requestId: string; status: string } // Variables type
  >({
    mutationFn: async ({ requestId, status }) => {
      const response = await fetch(`/api/borrows/data-requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to update data request status');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Data request status updated successfully!");
      refetchDataRequests(); // Refetch the data requests list
    },
    onError: (error) => {
      toast.error(`Error updating status: ${error.message}`);
    },
  });

  // --- NEW: Mutation for Uploading Data File ---
  /* const uploadDataFileMutation = useMutation<
    { message: string; file: { id: string; name: string; url: string }; updatedRequest: DataRequestAdminView },
    Error,
    { requestId: string; formData: FormData }
  >({
    mutationFn: async ({ requestId, formData }) => {
      const response = await fetch(`/api/borrows/data-requests/${requestId}/upload`, {
        method: 'POST',
        body: formData, // No Content-Type header needed for FormData
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to upload file');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message);
      refetchDataRequests(); // Refresh list to show new file
    },
    onError: (error) => {
      toast.error(`File upload failed: ${error.message}`);
    },
  }); */

  // --- NEW: Mutation for Cancelling/Deleting Data Request ---
  const cancelDataRequestMutation = useMutation<
    { message: string }, // Expected response type
    Error, // Error type
    { requestId: string } // Variables type
  >({
    mutationFn: async ({ requestId }) => {
      const response = await fetch(`/api/borrows/data-requests/${requestId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to cancel data request');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message || "Data request cancelled successfully!");
      refetchDataRequests(); // Refetch the data requests list
      queryClient.invalidateQueries({ queryKey: ['userDataRequests'] }); // Also invalidate user's view if they have one
    },
    onError: (error) => {
      toast.error(`Error cancelling request: ${error.message}`);
    },
  });

  /* const handleFileUpload = async (requestId: string) => {
    const file = filesToUpload[requestId];
    if (!file) {
      toast.warning("No file selected to upload.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    uploadDataFileMutation.mutate({ requestId, formData }, {
      onSuccess: (data) => {
        toast.success(data.message || "File uploaded successfully!");
        queryClient.invalidateQueries({ queryKey: ['dataRequestsAdmin'] });
        queryClient.invalidateQueries({ queryKey: ['userDataRequests'] }); // Also invalidate user's view
        // Clear the selected file for this request ID and reset the input
        setFilesToUpload(prev => ({ ...prev, [requestId]: null }));
        const fileInput = document.getElementById(`file-upload-input-${requestId}`) as HTMLInputElement;
        if (fileInput) {
          fileInput.value = ''; // Reset the file input
        }
      },
      onError: (error: Error) => {
        toast.error(error.message || "File upload failed.");
        console.error("Upload error:", error);
      }
    });
  }; */

  // Handler for when a file is selected via the input
  /* const onFileSelected = (requestId: string, selectedFile: File | null) => {
    setFilesToUpload(prev => ({ ...prev, [requestId]: selectedFile }));
  }; */

  // --- NEW: Mutation for Deleting Data File ---
  const deleteDataFileMutation = useMutation<
    { message: string; updatedRequest: DataRequestAdminView },
    Error,
    { requestId: string; fileId: string }
  >({
    mutationFn: async ({ requestId, fileId }) => {
      const response = await fetch(`/api/borrows/data-requests/${requestId}/delete-file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to delete file');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message);
      refetchDataRequests(); // Refresh list
    },
    onError: (error) => {
      toast.error(`File deletion failed: ${error.message}`);
    },
  });

  const handleDeleteDataFile = (requestId: string, fileIdOrName: string) => {
    // In a real app, you would show a confirmation dialog first
    if (deleteDataFileMutation.isPending) return;
    deleteDataFileMutation.mutate({ requestId, fileId: fileIdOrName }); // Assuming fileIdOrName is the unique ID
  };

  // Handler to call the mutation
  const handleUpdateDataRequestStatus = (requestId: string, status: string | null | undefined) => {
    if (!status) {
        toast.warning("Please select a status to update.");
        return;
    }
    if (updateDataRequestStatusMutation.isPending) return;
    updateDataRequestStatusMutation.mutate({ requestId, status });
  };

  const handleCancelDataRequest = (requestId: string, equipmentName: string | null | undefined) => {
    const requestNameToConfirm = equipmentName || `request ID ${requestId.substring(0, 8)}`;
    if (confirm(`Are you sure you want to cancel the data request for ${requestNameToConfirm}? This action cannot be undone.`)) {
      cancelDataRequestMutation.mutate({ requestId });
    }
  };

  const fetchGroupmateEmails = async (groupId: string): Promise<string[]> => {
    try {
      const response = await fetch(`/api/borrow-groups/${groupId}/member-emails`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch groupmate emails');
      }
      return await response.json() as string[];
    } catch (error) {
      console.error("Error fetching groupmate emails:", error);
      toast.error(error instanceof Error ? error.message : "Could not fetch groupmate emails.");
      return [];
    }
  };

  const handleEmailBorrowerAndGroupmates = async (request: DataRequestAdminView) => {
    let mailtoLink = `mailto:${request.borrower.email}`;
    if (request.borrowGroupId) {
      setIsFetchingGroupMates(true);
      try {
        const groupEmails = await fetchGroupmateEmails(request.borrowGroupId);
        const ccEmails = groupEmails.filter(email => email && email !== request.borrower.email).join(',');
        if (ccEmails) {
          mailtoLink += `?cc=${ccEmails}`;
        }
      } finally {
        setIsFetchingGroupMates(false);
      }
    }
    window.location.href = mailtoLink;
  };

  // --- NEW: Memoized Grouping Logic --- 
  const groupedGroupLogs = useMemo((): GroupedGroupBorrows => {
    return groupBorrowsData.reduce((acc, borrow) => {
        if (!borrow.borrowGroupId) return acc;
        const key = borrow.borrowGroupId;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(borrow);
        return acc;
    }, {} as GroupedGroupBorrows);
  }, [groupBorrowsData]);
  
  const sortedGroupLogIds = useMemo(() => {
      return Object.keys(groupedGroupLogs).sort((a, b) => {
          const lastItemA = groupedGroupLogs[a]?.slice(-1)[0];
          const lastItemB = groupedGroupLogs[b]?.slice(-1)[0];
          const dateA = lastItemA?.requestSubmissionTime ? new Date(lastItemA.requestSubmissionTime).getTime() : 0;
          const dateB = lastItemB?.requestSubmissionTime ? new Date(lastItemB.requestSubmissionTime).getTime() : 0;
          return dateB - dateA;
      });
  }, [groupedGroupLogs]);

  const fetchRequestsTableData = async () => {
    setIsLoadingRequests(true);
    setRequestsError(null);
    try {
      const response = await fetch('/api/borrows/admin');
      if (!response.ok) {
         const errorData: { error?: string } = await response.json().catch(() => ({ error: "Failed to parse error response" }));
         if (response.status === 401 || response.status === 403) {
             setRequestsError(errorData.error || "You do not have permission to view this page.");
             toast.error(errorData.error || "Access Denied");
         } else {
             throw new Error(errorData.error || `Failed to fetch borrow requests: ${response.statusText}`);
         }
      } else {
          const data: BorrowRequestAdminView[] = await response.json();
          console.log('[BorrowRequestsPage] Fetched data:', data);
          const mappedData = data.map(req => ({ ...req, isGroupRequest: !!req.borrowGroupId }));
          setRequests(mappedData);
      }
    } catch (err) {
      console.error("Error fetching borrow requests:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setRequestsError(message);
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
       fetchRequestsTableData();
    }
  }, [status]);

  useEffect(() => {
      console.log('[BorrowRequestsPage] Column filters changed:', columnFilters);
  }, [columnFilters]);

  const handleApproveGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
       toast.error("Cannot approve: Missing Group ID.");
       return;
    }
    if (isSubmittingAction) return;

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
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Bulk approve failed for group ${borrowGroupId}:`, e);
      toast.error(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRejectGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot reject: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return;

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
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Bulk reject failed for group ${borrowGroupId}:`, e);
      toast.error(e instanceof Error ? e.message : "Rejection failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleConfirmCheckoutGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot checkout: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return;

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
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Bulk checkout failed for group ${borrowGroupId}:`, e);
      toast.error(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleConfirmReturnGroup = async (borrowGroupId: string | null | undefined) => {
    if (!borrowGroupId) {
      toast.error("Cannot confirm return: Missing Group ID.");
      return;
    }
    if (isSubmittingAction) return;

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
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Bulk return failed for group ${borrowGroupId}:`, e);
      toast.error(e instanceof Error ? e.message : "Return confirmation failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const openConfirmReturnModal = (borrowRequest: BorrowRequestAdminView | null | undefined) => {
    if (!borrowRequest || !borrowRequest.id || !borrowRequest.equipment?.name) {
      console.error("Cannot open modal: Missing borrowId or equipment name.", borrowRequest);
      toast.error("Cannot confirm return: Missing Borrow Request info.");
      return;
    }
    setReturnTarget({ borrowId: borrowRequest.id, equipmentName: borrowRequest.equipment.name });
    setIsReturnModalOpen(true);
  };

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
              console.error("Failed to log deficiency:", deficiencyResult.error);
              toast.error(`Return confirmed, but failed to log deficiency: ${deficiencyResult.error || 'Unknown error'}`);
           } else {
              toast.info("Deficiency logged successfully.");
           }
         } catch (deficiencyError: unknown) {
             console.error("Error submitting deficiency log:", deficiencyError);
             toast.error("Return confirmed, but encountered an error logging the deficiency.");
         }
      }

      setIsReturnModalOpen(false);
      setReturnTarget(null);
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Confirm return process failed for borrow ${borrowId}:`, e);
      toast.error(e instanceof Error ? e.message : "Confirmation process failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleApproveItem = async (borrowId: string | null | undefined) => {
     if (!borrowId) {
       toast.error("Cannot approve: Missing Borrow ID.");
       return;
     }
     if (isSubmittingAction) return;
     
     setIsSubmittingAction(true);
     try {
        const response = await fetch('/api/borrows/bulk/approve', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ borrowId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to approve item');
        toast.success(`Borrow request ${borrowId} approved!`);
        fetchRequestsTableData();
     } catch (e: unknown) {
        console.error(`Failed to approve item ${borrowId}:`, e);
        toast.error(e instanceof Error ? e.message : 'Failed to approve item.');
     } finally {
        setIsSubmittingAction(false);
     }
  };
  
  const handleRejectItem = async (borrowId: string | null | undefined) => {
     if (!borrowId) {
        toast.error("Cannot reject: Missing Borrow ID.");
        return;
     }
     if (isSubmittingAction) return;

     setIsSubmittingAction(true);
     try {
        const response = await fetch('/api/borrows/bulk/reject', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ borrowId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to reject item');
        toast.success(`Borrow request ${borrowId} rejected!`);
        fetchRequestsTableData();
     } catch (e: unknown) {
        console.error(`Failed to reject item ${borrowId}:`, e);
        toast.error(e instanceof Error ? e.message : 'Failed to reject item.');
     } finally {
        setIsSubmittingAction(false);
     }
  };

  const handleCheckoutItem = async (borrowId: string | null | undefined) => {
    if (!borrowId) {
      toast.error("Cannot checkout: Missing Borrow ID.");
      return;
    }
    if (isSubmittingAction) return;

    setIsSubmittingAction(true);
    try {
      const response = await fetch('/api/borrows/bulk/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to checkout item (${response.status})`);
      }

      toast.success(result.message || "Item checked out successfully!");
      fetchRequestsTableData();

    } catch (e: unknown) {
      console.error(`Failed to checkout item ${borrowId}:`, e);
      toast.error(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" /> Loading...
      </div>
    );
  }

  const userRole = session?.user?.role;
  const isAuthorized = userRole === UserRole.STAFF || userRole === UserRole.FACULTY;

  if (status !== 'authenticated' || !isAuthorized) {
    return (
      <div className="container mx-auto py-10 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-destructive mb-2">Access Denied</h1>
        <p className="text-muted-foreground">
          You do not have permission to view this page. Please contact an administrator if you believe this is an error.
        </p>
      </div>
    );
  }

  const renderGroupBorrowLogs = (): React.ReactNode => {
      if (isLoadingGroupBorrows) return <LoadingSpinner>Loading Group Logs...</LoadingSpinner>;
      if (groupBorrowsError) return <p className="text-destructive">Error loading group logs: {groupBorrowsError.message}</p>;
      if (sortedGroupLogIds.length === 0) return <p className="text-muted-foreground italic">No group borrow records found.</p>;

      return (
        <div className="max-h-[600px] overflow-y-auto pr-1 space-y-4">
          {sortedGroupLogIds.map((groupId) => {
              const groupItems = groupedGroupLogs[groupId];
              if (!groupItems || groupItems.length === 0) return null;
              const representativeItem = groupItems[0];
              
              return (
                <Card key={groupId} className="bg-card/60 border">
                  <CardHeader className='pb-3'>
                      <CardTitle className="text-base flex items-center justify-between">
                          <Link
                            href={`/borrows/group/${groupId}`}
                            className='hover:underline flex items-center gap-2'
                            >
                              <Users className="h-4 w-4 text-muted-foreground"/> Group: {groupId}
                          </Link>
                          <div className="flex items-center gap-2">
                              <Badge 
                                  variant={getReservationTypeVariant(representativeItem.reservationType)}
                                  className="capitalize text-[10px] scale-95 whitespace-nowrap font-normal"
                              >
                                  {formatReservationType(representativeItem.reservationType)}
                              </Badge>
                              <Badge variant={getBorrowStatusVariant(representativeItem.borrowStatus)} className="capitalize text-xs whitespace-nowrap">
                                  {formatBorrowStatus(representativeItem.borrowStatus)}
                              </Badge>
                          </div>
                      </CardTitle>
                      <CardDescription className='text-xs mt-1 space-y-0.5'>
                          <span>Requested by {representativeItem.borrower.name ?? representativeItem.borrower.email} on {formatDateSafe(representativeItem.requestSubmissionTime, 'PP')}</span>
                          <span className='block'>Requested Time: {formatDateSafe(representativeItem.requestedStartTime, 'Pp')} - {formatDateSafe(representativeItem.requestedEndTime, 'Pp')}</span>
                          {representativeItem.class ? <span className='block'>Class: {representativeItem.class.courseCode} {representativeItem.class.section}</span> : ''}
                      </CardDescription>
                  </CardHeader>
                  <CardContent className='pt-0 pb-4 px-4'>
                      <p className='text-sm font-medium mb-2 text-muted-foreground'>Items ({groupItems.length}):</p>
                      <ul className="space-y-1.5 text-xs pl-2">
                          {groupItems.map(item => (
                              <li key={item.id} className='flex items-center gap-2'>
                                 <Image 
                                     src={transformGoogleDriveUrl(item.equipment?.images?.[0]) || '/images/placeholder-default.png'}
                                     alt={item.equipment?.name || 'Equipment'}
                                     width={24} height={24} 
                                     className="rounded object-contain aspect-square bg-background border"
                                     onError={(_e) => {
                                       if (_e.currentTarget.src !== '/images/placeholder-default.png') {
                                         _e.currentTarget.srcset = '/images/placeholder-default.png';
                                         _e.currentTarget.src = '/images/placeholder-default.png';
                                       }
                                     }}
                                 />
                                 <span className='flex-grow truncate' title={`${item.equipment?.name || 'Unknown'} (${item.equipment?.equipmentId ?? 'N/A'})`}>
                                    {item.equipment?.name || 'Unknown Equipment'}
                                    <span className="text-muted-foreground/80 text-[10px] ml-1">({item.equipment?.equipmentId ?? 'N/A'})</span>
                                 </span>
                                 <Badge variant={getBorrowStatusVariant(item.borrowStatus)} className="capitalize text-[10px] scale-90 whitespace-nowrap">
                                      {formatBorrowStatus(item.borrowStatus)}
                                  </Badge>
                              </li>
                          ))}
                      </ul>
                  </CardContent>
                </Card>
              );
          })}
        </div>
      );
  };

  // --- NEW: Render Function for Data Requests Section ---
  const renderDataRequestsSection = (): React.ReactNode => {
    if (isLoadingDataRequests) {
      return <div className="p-4 text-center"><LoadingSpinner /> Loading data requests...</div>;
    }
    if (dataRequestsError) {
      return <div className="p-4 text-destructive text-center">Error loading data requests: {dataRequestsError.message}</div>;
    }
    if (dataRequests.length === 0) {
      return <p className="text-muted-foreground italic p-4 text-center">No pending data requests.</p>;
    }

    // Sort by updatedAt descending (newest first)
    const sortedDataRequests = [...dataRequests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return (
      <div className="space-y-4">
        {sortedDataRequests.map((req) => (
          <Card key={req.id} className="bg-card/70 border-border/40">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">
                    Data Request for: {req.equipment?.name || 'N/A'} ({req.equipment?.equipmentId || 'N/A'})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Requested by: {req.borrower.name || req.borrower.email} on {formatDateSafe(req.requestSubmissionTime, 'PPp')}
                  </CardDescription>
                </div>
                <Badge variant={req.dataRequestStatus === 'Fulfilled' ? 'success' : (req.dataRequestStatus === 'Pending' ? 'warning' : 'secondary')}>
                  {req.dataRequestStatus || 'Unknown'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {req.dataRequestRemarks && (
                <p className="text-sm p-3 bg-muted/50 rounded-md border border-dashed">
                  <span className="font-semibold">Remarks:</span> {req.dataRequestRemarks}
                </p>
              )}
              
              {/* File Management UI */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Attached Files:</h4>
                {req.dataFiles && req.dataFiles.length > 0 ? (
                  <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                    {req.dataFiles.map(file => (
                      <li key={file.id || file.name} className="flex justify-between items-center">
                        {/* For now, assume file.url is a direct link or display name if no URL yet */}
                        <span className="text-primary truncate max-w-xs flex items-center gap-1">
                          {file.name}
                          {file.size && <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>}
                          {file.type && <Badge variant="outline" className="text-xs scale-90 font-normal">{file.type}</Badge>}
                        </span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-destructive hover:bg-destructive/10 h-7 w-7 p-0"
                          onClick={() => handleDeleteDataFile(req.id, file.id || file.name)} // Pass file identifier
                          disabled={updateDataRequestStatusMutation.isPending} // Or a dedicated loading state for file operations
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No files uploaded yet.</p>
                )}
                {/* File Upload Area - Modernized */}
                {/* <div className="space-y-2 pt-1">
                  <Label htmlFor={`file-upload-input-${req.id}`} className="text-sm font-medium">
                    Upload Data File:
                  </Label>
                  <div 
                    className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/70 transition-colors bg-background/50"
                    onClick={() => document.getElementById(`file-upload-input-${req.id}`)?.click()}
                  >
                    <div className="space-y-1 text-center">
                      <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
                      <div className="flex text-sm text-muted-foreground">
                        <span className="relative rounded-md font-medium text-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary hover:text-primary/80">
                          Click to upload
                        </span>
                        <p className="pl-1">or drag and drop (drag-n-drop not implemented yet)</p>
                      </div>
                      <p className="text-xs text-muted-foreground/80">Supports CSV, TXT, ZIP, PDF, etc. up to X MB (Update size limit)</p>
                    </div>
                  </div>
                  <input 
                    type="file" 
                    id={`file-upload-input-${req.id}`} 
                    className="sr-only" // Hidden, triggered by the div
                    onChange={(e) => onFileSelected(req.id, e.target.files ? e.target.files[0] : null)}
                    disabled={uploadDataFileMutation.isPending || updateDataRequestStatusMutation.isPending}
                  />
                  
                  {filesToUpload[req.id] && (
                    <div className="mt-2 flex items-center justify-between p-2 border rounded-md bg-muted/30">
                      <div className="text-sm text-foreground truncate">
                        Selected: {filesToUpload[req.id]?.name} 
                        {filesToUpload[req.id]?.size && 
                          <span className="text-xs text-muted-foreground pl-1">({(filesToUpload[req.id]!.size / 1024).toFixed(1)} KB)</span>
                        }
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-destructive hover:bg-destructive/10 h-7 w-7 p-0"
                        onClick={() => {
                          onFileSelected(req.id, null); // Clear from state
                          const fileInput = document.getElementById(`file-upload-input-${req.id}`) as HTMLInputElement;
                          if (fileInput) fileInput.value = ''; // Reset input field
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  <Button 
                    size="sm" 
                    className="h-9 text-xs mt-2 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-70" // Improved styling for visibility
                    onClick={() => handleFileUpload(req.id)} // Simplified, uses file from state
                    disabled={!filesToUpload[req.id] || uploadDataFileMutation.isPending || updateDataRequestStatusMutation.isPending} 
                  >
                    {uploadDataFileMutation.isPending && uploadDataFileMutation.variables?.requestId === req.id 
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                      : <UploadCloud className="mr-2 h-4 w-4" /> } 
                    Confirm & Upload File
                  </Button>
                </div> */}
              </div>

              {/* Status Update UI */}
              <div className="flex items-center gap-2 pt-2 border-t border-border/20 mt-3">
                <Select
                  defaultValue={req.dataRequestStatus || undefined}
                  onValueChange={(newStatus) => handleUpdateDataRequestStatus(req.id, newStatus)} // Directly call handler on change
                  disabled={updateDataRequestStatusMutation.isPending || cancelDataRequestMutation.isPending}
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
                  onClick={() => handleEmailBorrowerAndGroupmates(req)}
                  disabled={updateDataRequestStatusMutation.isPending || cancelDataRequestMutation.isPending || isFetchingGroupMates}
                >
                  {isFetchingGroupMates && (cancelDataRequestMutation.variables?.requestId === req.id || updateDataRequestStatusMutation.variables?.requestId === req.id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Email Borrower
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs text-destructive hover:border-destructive/70 hover:text-destructive"
                  onClick={() => handleCancelDataRequest(req.id, req.equipment?.name)}
                  disabled={updateDataRequestStatusMutation.isPending || cancelDataRequestMutation.isPending || (req.dataRequestStatus === 'Fulfilled' && req.dataFiles.length > 0)}
                >
                  {cancelDataRequestMutation.isPending && cancelDataRequestMutation.variables?.requestId === req.id 
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                    : <Trash2 className="mr-2 h-4 w-4" />}
                  Cancel Request
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
           <h1 className="text-3xl font-bold tracking-tight text-foreground">Borrow Management</h1>
           <p className="text-muted-foreground">
             View and manage all individual and group borrow requests, active checkouts, and pending returns.
           </p>
        </div>
      </div>
      
      {/* Main Actions Table */}
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="h-6 w-6 text-primary" />
            All Borrow Actions
          </CardTitle>
          <CardDescription>
            This table shows all individual borrow transactions. Use filters to narrow down results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingRequests && <div className="h-60 flex items-center justify-center"><LoadingSpinner /></div>}
          {requestsError && <div className="text-destructive p-4 text-center">{requestsError}</div>}
          {!isLoadingRequests && !requestsError && (
            <DataTable 
              columns={columns}
              data={requests} 
              meta={{
                onApprove: handleApproveItem, 
                onReject: handleRejectItem,
                onCheckout: handleCheckoutItem,
                onConfirmReturn: openConfirmReturnModal, 
                isSubmittingAction: isSubmittingAction,
                approveGroupHandler: handleApproveGroup, 
                rejectGroupHandler: handleRejectGroup,
                confirmCheckoutGroupHandler: handleConfirmCheckoutGroup,
                confirmReturnGroupHandler: handleConfirmReturnGroup,
              }}
              columnFilters={columnFilters}
              onColumnFiltersChange={setColumnFilters}
            />
          )}
        </CardContent>
      </Card>

      {/* Section for Grouped Borrow Logs */}
      <Card className="border-border/40">
          <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                  <Users className="h-6 w-6 text-primary" />
                  Group Transaction Logs
              </CardTitle>
              <CardDescription>
                  Overview of all group transactions, including pending, active, and completed ones.
              </CardDescription>
          </CardHeader>
          <CardContent>
              {isLoadingGroupBorrows && <div className="h-60 flex items-center justify-center"><LoadingSpinner /></div>}
              {groupBorrowsError && <div className="text-destructive p-4 text-center">Error: {groupBorrowsError.message}</div>}
              {!isLoadingGroupBorrows && !groupBorrowsError && Object.keys(groupedGroupLogs).length === 0 && (
                  <p className="text-muted-foreground italic text-center p-4">No group transactions found.</p>
              )}
              {!isLoadingGroupBorrows && !groupBorrowsError && Object.keys(groupedGroupLogs).length > 0 && renderGroupBorrowLogs()}
          </CardContent>
      </Card>

      {/* --- NEW: Section for Data Requests --- */}
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-6 w-6 text-primary" />
            Data Requests
          </CardTitle>
          <CardDescription>
            Manage data requests submitted by borrowers during the return process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderDataRequestsSection()}
        </CardContent>
      </Card>

      {returnTarget && (
        <ConfirmReturnModal
            isOpen={isReturnModalOpen}
            onOpenChange={setIsReturnModalOpen}
            onSubmit={submitReturnConfirmation}
            isSubmitting={isSubmittingAction}
            borrowId={returnTarget.borrowId}
            equipmentName={returnTarget.equipmentName}
        />
      )}
    </div>
  );
} 