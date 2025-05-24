'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { toast } from "sonner";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Image from 'next/image';
import { format, isValid } from 'date-fns';
import { Users, Loader2, ArrowRightCircle } from 'lucide-react';
// Import types
import { Borrow, Equipment, Class, BorrowStatus, ReservationType } from '@prisma/client';
// Import the new modal
import ReportDeficiencyModal from '@/components/deficiencies/ReportDeficiencyModal';
import { transformGoogleDriveUrl } from "@/lib/utils";

// Define the shape of the data expected from the user borrows endpoint
// Make sure this includes fields needed by the modal (id, borrowGroupId, equipment details)
// and for checkout logic (approvedStartTime, borrowStatus)
type UserBorrowView = Borrow & {
  equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId' | 'images'>;
  class: Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'> | null;
  expectedReturnTime: Date | null;
  borrowGroupId: string | null;
  reservationType?: ReservationType | null;
  borrower: { id: string; name: string | null; email: string | null; };
  // Ensure approvedStartTime is part of the Borrow type from Prisma, if not, it needs to be added to the API response and this type
  // Assuming Borrow type from Prisma includes:
  // approvedStartTime: Date | string | null; 
  // borrowStatus: BorrowStatus;
};

// Grouped borrows structure
interface GroupedBorrows {
  [groupId: string]: UserBorrowView[];
}

const INDIVIDUAL_BORROWS_KEY = "__individual__";

// Helper function to safely format dates
const formatDateSafe = (dateInput: string | Date | null | undefined, formatString: string = 'PPp'): string => {
  console.log(`[formatDateSafe] Input:`, dateInput); // Log input
  if (!dateInput) {
    console.log(`[formatDateSafe] Output: N/A (Input was null/undefined)`);
    return 'N/A';
  }
  const date = new Date(dateInput);
  const valid = isValid(date);
  console.log(`[formatDateSafe] Parsed Date: ${date}, IsValid: ${valid}`); // Log parsed date and validity
  const result = valid ? format(date, formatString) : 'Invalid Date';
  console.log(`[formatDateSafe] Output: ${result}`);
  return result;
};

// *** NEW: Helpers for Reservation Type Display ***
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'IN CLASS' : 'OUT OF CLASS';
};
const getReservationTypeVariant = (type: ReservationType | null | undefined): "success" | "destructive" | "secondary" => {
    if (!type) return 'secondary';
    return type === 'IN_CLASS' ? 'success' : 'destructive';
};

// *** NEW: Add formatBorrowStatus helper ***
const formatBorrowStatus = (status: BorrowStatus): string => {
    if (!status) return 'N/A';
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export default function MyBorrowsPage() {
  const [borrows, setBorrows] = useState<UserBorrowView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null); // For loading state on checkout button
  // State for modal control
  const [isDeficiencyModalOpen, setIsDeficiencyModalOpen] = useState(false);
  const [itemsToReportForModal, setItemsToReportForModal] = useState<UserBorrowView[]>([]);
  // State for loading during the actual PATCH request
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  
  const fetchBorrows = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/user/borrows');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch borrows: ${response.statusText}`);
      }
      const data: UserBorrowView[] = await response.json();
      setBorrows(data);
    } catch (err) {
      console.error("Error fetching user borrows:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      toast.error(`Error loading borrows: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBorrows();
  }, []);

  // Group borrows by borrowGroupId using useMemo
  const groupedBorrows = useMemo((): GroupedBorrows => {
    return borrows.reduce((acc, borrow) => {
      const key = borrow.borrowGroupId || INDIVIDUAL_BORROWS_KEY;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(borrow);
      return acc;
    }, {} as GroupedBorrows);
  }, [borrows]);

  // --- Function to initiate the ACTUAL return request PATCH ---
  const handleReturnRequest = async (
    identifier: string, 
    isGroup: boolean,
    requestData?: boolean,
    dataRequestDetails?: { remarks?: string; equipmentIds?: string[] }
  ) => {
    console.log(`[handleReturnRequest] Initiating for ${isGroup ? 'group' : 'item'}: ${identifier}, Request Data: ${requestData}, Details: ${JSON.stringify(dataRequestDetails)}`);
    
    setIsSubmittingReturn(true);
    const url = isGroup 
        ? `/api/borrows/bulk/request-return?groupId=${identifier}`
        : `/api/borrows/${identifier}/request-return`;
    
    const bodyPayload: { requestData?: boolean; dataRequestRemarks?: string; requestedEquipmentIds?: string[] } = {};
    if (requestData && dataRequestDetails) {
      bodyPayload.requestData = true;
      if (dataRequestDetails.remarks) {
        bodyPayload.dataRequestRemarks = dataRequestDetails.remarks;
      }
      if (dataRequestDetails.equipmentIds && dataRequestDetails.equipmentIds.length > 0) {
        bodyPayload.requestedEquipmentIds = dataRequestDetails.equipmentIds;
      }
    } else {
      bodyPayload.requestData = false; 
    }

    const successMessage = isGroup 
        ? `Return requested for group ${identifier}.`
        : "Return requested successfully! Proceed to designated return area.";
    const errorMessage = isGroup
        ? `Failed to request return for group ${identifier}.`
        : "Failed to request return.";

    try {
        const response = await fetch(url, { 
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || result.error || `Request failed (${response.status})`);
        }
        toast.success(result.message || successMessage);
        // Update status locally
        setBorrows(prev => 
            prev.map(b => 
                (isGroup && b.borrowGroupId === identifier) || (!isGroup && b.id === identifier) 
                    ? { ...b, borrowStatus: BorrowStatus.PENDING_RETURN } 
                    : b
            )
        );
    } catch (error) {
        console.error(errorMessage, error);
        toast.error(error instanceof Error ? error.message : errorMessage);
        throw error; // Re-throw error so modal knows it failed
    } finally {
        setIsSubmittingReturn(false);
    }
  };

  const handleCheckout = async (borrowId: string) => {
    setCheckingOutId(borrowId);
    try {
      // The checkout API seems to be PATCH /api/borrows/[borrowId]/checkout
      const response = await fetch(`/api/borrows/${borrowId}/checkout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Failed to checkout item.');
      }
      toast.success('Item checked out successfully!');
      fetchBorrows(); // Refresh borrows list
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unknown error occurred during checkout.';
      toast.error(message);
      console.error("Checkout error:", err);
    } finally {
      setCheckingOutId(null);
    }
  };

  // --- Modified handler to OPEN the modal for group items ---
  const handleOpenDeficiencyModalForGroup = (groupId: string) => {
    const groupItems = groupedBorrows[groupId];
    if (groupItems && groupItems.length > 0) {
      setItemsToReportForModal(groupItems);
      setIsDeficiencyModalOpen(true);
    }
  };

  // Helper to get status badge variant
  const getStatusVariant = (status: BorrowStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
      if (status === BorrowStatus.ACTIVE) return "success";
      if (status === BorrowStatus.OVERDUE) return "destructive";
      if (status === BorrowStatus.PENDING_RETURN) return "warning";
      return "secondary"; 
  };
  
  // Separate individual borrows for distinct rendering
  const individualBorrows = groupedBorrows[INDIVIDUAL_BORROWS_KEY] || [];
  const groupIds = Object.keys(groupedBorrows).filter(key => key !== INDIVIDUAL_BORROWS_KEY);

  // --- Render Function for Borrow Card Items (used for both individual and group) ---
  const renderBorrowItems = (items: UserBorrowView[]) => (
      <ul className="space-y-3 mt-3">
          {items.map(item => {
              // Checkout button logic simplified
              let canCheckout = false;
              let showCheckoutButton = false;

              if (item.borrowStatus === BorrowStatus.APPROVED) {
                showCheckoutButton = true;
                canCheckout = true; // Button is always enabled if status is APPROVED
              }

              return (
                <li key={item.id} className="flex items-start gap-3 border-b pb-3 last:border-b-0">
                    <Image 
                        src={transformGoogleDriveUrl(item.equipment.images?.[0]) || '/images/placeholder-default.png'}
                        alt={item.equipment.name}
                        width={48} height={48}
                        className="rounded object-cover aspect-square mt-1"
                        onError={(e) => {
                          if (e.currentTarget.src !== '/images/placeholder-default.png') {
                            e.currentTarget.srcset = '/images/placeholder-default.png';
                            e.currentTarget.src = '/images/placeholder-default.png';
                          }
                        }}
                    />
                    <div className="flex-grow">
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-sm text-foreground truncate" title={item.equipment.name}>{item.equipment.name}</span>
                            {/* Badges: Status & Type */}
                            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                {/* Reservation Type Badge - MODIFIED className */}
                                <Badge 
                                    variant={getReservationTypeVariant(item.reservationType)}
                                    className="text-xs whitespace-nowrap"
                                    title={`Reservation Type: ${formatReservationType(item.reservationType)}`}
                                >
                                    {formatReservationType(item.reservationType)}
                                </Badge>
                                {/* Status Badge */}
                                <Badge variant={getStatusVariant(item.borrowStatus)} className="capitalize text-xs whitespace-nowrap">
                                    {formatBorrowStatus(item.borrowStatus)}
                                </Badge>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Equipment ID: {item.equipment.equipmentId || 'N/A'}</p>
                        <p className="text-xs text-muted-foreground">Checkout Time: {formatDateSafe(item.checkoutTime)}</p>
                        {/* Display Due Time / Overdue Info */}
                        {/* ... Existing due time / overdue logic ... */}
                    </div>
                    <div className="flex flex-col items-end gap-2"> {/* Changed to flex-col and items-end for button stacking */}
                        {/* Checkout Button - Timed Visibility */}
                        {showCheckoutButton && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="bg-blue-500 hover:bg-blue-600 text-white border-blue-500 hover:border-blue-600"
                                onClick={() => handleCheckout(item.id)}
                                disabled={checkingOutId === item.id || !canCheckout}
                                title={canCheckout ? "Checkout this item" : "Item not ready for checkout"}
                            >
                                {checkingOutId === item.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <ArrowRightCircle className="mr-2 h-4 w-4" />
                                )}
                                Checkout
                            </Button>
                        )}
                        {/* Add other actions like cancel if applicable - this was the original content of the div */}
                        {/* Example: Retain existing cancel button logic if it were here */}
                    </div>
                </li>
              );
          })}
      </ul>
  );

  if (isLoading) return <div className="flex justify-center items-center h-[calc(100vh-200px)]"><LoadingSpinner /></div>;
  if (error) return <div className="text-center text-destructive py-10">Error: {error}</div>;
  if (borrows.length === 0) return <div className="text-center text-muted-foreground py-10">You have no borrow history.</div>;

  return (
      <div className="container mx-auto p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">My Borrows</h1>
            {/* Optional: Add a global action button here if needed */}
          </div>

          {/* Individual Borrows Section */}
          {individualBorrows.length > 0 && (
              <Card>
                  <CardHeader>
                      <CardTitle>Individual Borrows</CardTitle>
                      <CardDescription>Items you have borrowed individually.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      {renderBorrowItems(individualBorrows)}
                  </CardContent>
              </Card>
          )}

          {/* Grouped Borrows Section */}
          {groupIds.map(groupId => {
              const groupItems = groupedBorrows[groupId];
              const firstItemInGroup = groupItems[0]; // For common details like class info
              if (!firstItemInGroup) return null;

              return (
                <Card key={groupId}>
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle className="flex items-center">
                                    <Users className="mr-2 h-5 w-5 text-muted-foreground" /> 
                                    Group Borrow
                                </CardTitle>
                                <CardDescription>
                                    {firstItemInGroup.class ? 
                                        `Class: ${firstItemInGroup.class.courseCode} - ${firstItemInGroup.class.section} (${firstItemInGroup.class.semester})` : 
                                        'Class: N/A'}
                                </CardDescription>
                            </div>
                            {/* Group Action Button - Only if any item in group is ACTIVE/OVERDUE */}
                            {groupItems.some(item => item.borrowStatus === BorrowStatus.ACTIVE || item.borrowStatus === BorrowStatus.OVERDUE) && (
                                <Button 
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenDeficiencyModalForGroup(groupId)}
                                    disabled={isSubmittingReturn} 
                                >
                                    {isSubmittingReturn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} 
                                    Request Group Return / Report
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {renderBorrowItems(groupItems)}
                    </CardContent>
                </Card>
              );
          })}

          <ReportDeficiencyModal 
              isOpen={isDeficiencyModalOpen}
              onOpenChange={setIsDeficiencyModalOpen}
              itemsToReport={itemsToReportForModal}
              onReturnRequestInitiated={handleReturnRequest}
          />
      </div>
  );
} 