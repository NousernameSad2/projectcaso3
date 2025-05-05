'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { toast } from "sonner";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Image from 'next/image';
import { format, isValid, formatDistanceStrict } from 'date-fns';
import Link from 'next/link';
import { Users, List } from 'lucide-react';
// Import types
import { Borrow, Equipment, Class, BorrowStatus, ReservationType } from '@prisma/client';
// Import the new modal
import ReportDeficiencyModal from '@/components/deficiencies/ReportDeficiencyModal';

// Define the shape of the data expected from the user borrows endpoint
// Make sure this includes fields needed by the modal (id, borrowGroupId, equipment details)
type UserBorrowView = Borrow & {
  equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId' | 'images'>;
  class: Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'>;
  expectedReturnTime: Date | null;
  borrowGroupId: string | null;
  reservationType?: ReservationType | null;
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

// --- NEW: Utility function to calculate duration ---
const calculateDuration = (start: Date | string | null | undefined, end: Date | string | null | undefined): string => {
    if (!start || !end) return 'N/A';
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!isValid(startDate) || !isValid(endDate)) return 'Invalid dates';
    
    try {
        return formatDistanceStrict(endDate, startDate, { addSuffix: false }); // Use 'false' to remove "ago"
    } catch (e) {
        console.error("Error calculating duration:", e);
        return "Calculation error";
    }
};
// --- END NEW ---

// *** NEW: Helpers for Reservation Type Display ***
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'In Class' : 'Out of Class';
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
  // State for modal control
  const [isDeficiencyModalOpen, setIsDeficiencyModalOpen] = useState(false);
  const [itemsToReportForModal, setItemsToReportForModal] = useState<UserBorrowView[]>([]);
  // State for loading during the actual PATCH request
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  
  // --- NEW: State for current time, updated periodically ---
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timerId = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timerId); // Cleanup on unmount
  }, []);
  // --- END NEW ---

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
  const triggerActualReturnRequest = async (identifier: string, isGroup: boolean) => {
      setIsSubmittingReturn(true);
      const url = isGroup 
          ? `/api/borrows/bulk/request-return?groupId=${identifier}`
          : `/api/borrows/${identifier}/request-return`;
      const successMessage = isGroup 
          ? `Return requested for group ${identifier}.`
          : "Return requested successfully! Proceed to designated return area.";
      const errorMessage = isGroup
          ? `Failed to request return for group ${identifier}.`
          : "Failed to request return.";

      try {
          const response = await fetch(url, { method: 'PATCH' });
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

  // --- Modified handler to OPEN the modal for individual items ---
  const handleOpenDeficiencyModalForSingle = (borrowId: string) => {
    const borrowItem = borrows.find(b => b.id === borrowId);
    if (borrowItem) {
      setItemsToReportForModal([borrowItem]);
      setIsDeficiencyModalOpen(true);
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
          {items.map(item => (
              <li key={item.id} className="flex items-start gap-3 border-b pb-3 last:border-b-0">
                  <Image 
                      src={item.equipment.images?.[0] || '/images/placeholder-default.png'}
                      alt={item.equipment.name}
                      width={48} height={48}
                      className="rounded object-cover aspect-square mt-1"
                  />
                  <div className="flex-grow">
                      <div className="flex justify-between items-center mb-1">
                          <span className="font-medium text-sm text-foreground truncate" title={item.equipment.name}>{item.equipment.name}</span>
                          {/* Badges: Status & Type */}
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                              {/* *** Reservation Type Badge *** */}
                              <Badge 
                                  variant={getReservationTypeVariant(item.reservationType)}
                                  className="capitalize text-[10px] scale-90 whitespace-nowrap font-normal"
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
              </li>
          ))}
      </ul>
  );

  return (
      <div className="space-y-8">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-white">My Current Borrows</h1>
          </div>
          {isLoading && (
            <div className="flex justify-center items-center py-10"><LoadingSpinner size="lg" /></div>
          )}
          {error && (
            <div className="text-center text-destructive py-10"><p>Error loading borrows: {error}</p></div>
          )}
          {!isLoading && !error && borrows.length === 0 && (
            <div className="text-center text-muted-foreground py-10"><p>You have no active borrows.</p></div>
          )}
          {/* Render Grouped Borrows */}
          {!isLoading && !error && groupIds.length > 0 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-white border-b pb-2">Group Borrows</h2>
              {groupIds.map((groupId) => {
                const groupItems = groupedBorrows[groupId];
                const representativeItem = groupItems[0];
                // Disable button if submitting this group OR any individual item (simplification)
                const isSubmittingThisGroup = isSubmittingReturn; 

                return (
                    <Card key={groupId} className="overflow-hidden bg-card/60 border">
                        <CardHeader className="flex flex-row justify-between items-start gap-4">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                   <Users className="h-5 w-5"/> Group: {groupId}
                                </CardTitle>
                                <CardDescription className="text-xs mt-1">
                                   Class: {representativeItem.class?.courseCode || 'N/A'} - {representativeItem.class?.section || 'N/A'} ({representativeItem.class?.semester || 'N/A'}) <br/>
                                   Checked out: {formatDateSafe(representativeItem.checkoutTime)} | 
                                   Time Checked Out: {calculateDuration(representativeItem.checkoutTime, currentTime)}
                                </CardDescription>
                            </div>
                            <Link href={`/borrows/group/${groupId}`} passHref>
                               <Button variant="outline" size="sm" asChild>
                                   <span>View Details</span>
                               </Button>
                            </Link>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Items ({groupItems.length}):</h4>
                            {renderBorrowItems(groupItems)}
                        </CardContent>
                        <CardFooter className="p-4 pt-2">
                            <Button
                              onClick={() => handleOpenDeficiencyModalForGroup(groupId)}
                              // Disable if submitting OR if the group is no longer actionable (e.g., pending return)
                              disabled={isSubmittingReturn || !groupItems.some(item => item.borrowStatus === BorrowStatus.ACTIVE || item.borrowStatus === BorrowStatus.OVERDUE)}
                              // Hidden logic remains the same (based on status)
                              hidden={!groupItems.some(item => item.borrowStatus === BorrowStatus.ACTIVE || item.borrowStatus === BorrowStatus.OVERDUE)}
                            >
                              Initiate Group Return / Report Issues
                            </Button>
                        </CardFooter>
                    </Card>
                );
              })}
            </div>
          )}
          {/* Render Individual Borrows (if any) */}
          {!isLoading && !error && individualBorrows.length > 0 && (
             <div className="space-y-6 pt-6">
                 <h2 className="text-xl font-semibold text-white border-b pb-2">Individual Borrows</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                     {individualBorrows.map((borrow) => {
                         const imageUrl = borrow.equipment.images?.[0] || '/images/placeholder-default.png';
                         // Disable button if submitting this item OR any group item (simplification)
                         const isSubmittingThisItem = isSubmittingReturn; 
                         return (
                             <Card key={borrow.id} className="overflow-hidden flex flex-col h-full bg-card/60">
                                 <CardHeader className="p-0 relative aspect-video">
                                     <Image
                                         src={imageUrl}
                                         alt={borrow.equipment.name}
                                         fill
                                         className="object-cover"
                                         sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                     />
                                     <Badge variant={getStatusVariant(borrow.borrowStatus)} className="absolute top-2 right-2 capitalize text-xs">
                                         {borrow.borrowStatus.toLowerCase().replace('_', ' ')}
                                     </Badge>
                                 </CardHeader>
                                 <CardContent className="p-4 flex-grow">
                                     <h3 className="font-semibold text-base mb-1">{borrow.equipment.name}</h3>
                                     <p className="text-xs text-muted-foreground mb-2">ID: {borrow.equipment.equipmentId || 'N/A'}</p>
                                     <p className="text-xs text-muted-foreground">
                                         Class: {borrow.class?.courseCode || 'N/A'} - {borrow.class?.section || 'N/A'} ({borrow.class?.semester || 'N/A'})
                                     </p>
                                     <p className="text-xs text-muted-foreground">
                                         Checked out: {formatDateSafe(borrow.checkoutTime)} | 
                                         Time Checked Out: {calculateDuration(borrow.checkoutTime, currentTime)}
                                     </p>
                                 </CardContent>
                                 <CardFooter className="p-4 pt-0 border-t mt-auto">
                                     <Button
                                         onClick={() => handleOpenDeficiencyModalForSingle(borrow.id)}
                                         disabled={isSubmittingThisItem}
                                         size="sm"
                                         className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                     >
                                         {isSubmittingThisItem ? <LoadingSpinner size="sm" className="mr-2"/> : null}
                                         Request Return
                                     </Button>
                                 </CardFooter>
                             </Card>
                         );
                     })}
                 </div>
             </div>
          )}
          {/* Render the Modal */}
          <ReportDeficiencyModal 
              isOpen={isDeficiencyModalOpen}
              onOpenChange={setIsDeficiencyModalOpen}
              itemsToReport={itemsToReportForModal}
              onReturnRequestInitiated={triggerActualReturnRequest}
          />
      </div>
  );
} 