'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { toast } from "sonner";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { DataTable } from "@/components/ui/data-table";
import { columns, type BorrowRequestAdminView } from "./columns";
import ConfirmReturnModal from "@/components/borrow/ConfirmReturnModal";
import { DeficiencyType, BorrowStatus, Borrow, Equipment, User, Class, ReservationType } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ColumnFiltersState } from "@tanstack/react-table";
import { useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollText, Database, FileText, AlertCircle, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { format, isValid } from 'date-fns';
import { transformGoogleDriveUrl } from "@/lib/utils";

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
    if (!borrowRequest?.id) {
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
       toast.error("Missing Borrow ID.");
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
        toast.error("Missing Borrow ID.");
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

  return (
    <div className="container mx-auto py-10 space-y-8">
      <h1 className="text-3xl font-bold text-white">Borrow Requests & Logs</h1>
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Database className="mr-2 h-5 w-5" /> Data Requests
          </CardTitle>
          <CardDescription>Requests for data exports or reports. (Functionality coming soon)</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground italic">Data request functionality is under development.</p>
        </CardContent>
      </Card>
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center">
            <FileText className="mr-2 h-5 w-5" /> Inventory Logs
          </CardTitle>
          <CardDescription>Track all inventory movement.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between py-4">
               <div className="flex items-center gap-2">
                   <Input
                     placeholder="Filter by borrower..."
                     onChange={(event) => {
                       const currentFilters = columnFilters.filter((f: { id: string; value: unknown }) => f.id !== 'borrower.name');
                       setColumnFilters([...currentFilters, { id: 'borrower.name', value: event.target.value }]);
                     }}
                     className="max-w-sm h-9"
                   />
                   <Select
                     value={columnFilters.find((f: { id: string; value: unknown }) => f.id === 'borrowStatus')?.value as string | undefined}
                     onValueChange={(value) => {
                       const currentFilters = columnFilters.filter((f: { id: string; value: unknown }) => f.id !== 'borrowStatus');
                       const newValue = value === '' ? undefined : value;
                       console.log('[BorrowRequestsPage] Setting status filter:', newValue);
                       setColumnFilters([...currentFilters, { id: 'borrowStatus', value: newValue }]);
                     }}
                   >
                     <SelectTrigger className="w-[180px] h-9">
                       <SelectValue placeholder="Filter by Status" />
                     </SelectTrigger>
                     <SelectContent>
                       {Object.values(BorrowStatus).map((status) => {
                           if (typeof status !== 'string' || !status) return null;
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
            {isLoadingRequests && (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" />
              </div>
            )}
            {requestsError && (
              <div className="text-center text-destructive py-10">
                <p>{requestsError}</p>
              </div>
            )}
            {!isLoadingRequests && !requestsError && (
               <DataTable 
                  columns={columns} 
                  data={requests} 
                  meta={{
                     approveGroupHandler: handleApproveGroup,
                     rejectGroupHandler: handleRejectGroup,
                     confirmCheckoutGroupHandler: handleConfirmCheckoutGroup,
                     confirmReturnGroupHandler: handleConfirmReturnGroup,
                     approveItemHandler: handleApproveItem,
                     rejectItemHandler: handleRejectItem,
                     openConfirmReturnModalHandler: openConfirmReturnModal, 
                     isSubmittingAction: isSubmittingAction,
                  }}
                  columnFilters={columnFilters}
                  onColumnFiltersChange={setColumnFilters}
               />
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center">
            <ScrollText className="mr-2 h-5 w-5" /> Group Borrow Logs
          </CardTitle>
          <CardDescription>Overview of all group borrow requests, including reservation type.</CardDescription>
        </CardHeader>
        <CardContent>
          {renderGroupBorrowLogs()}
        </CardContent>
      </Card>
      <ConfirmReturnModal
          isOpen={isReturnModalOpen}
          onOpenChange={setIsReturnModalOpen}
          onSubmit={submitReturnConfirmation}
          isSubmitting={isSubmittingAction}
          borrowId={returnTarget?.borrowId ?? null}
          equipmentName={returnTarget?.equipmentName}
      />
    </div>
  );
} 