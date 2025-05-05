'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Borrow, BorrowStatus, Equipment } from '@prisma/client';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AlertCircle, RefreshCw } from 'lucide-react';
import ReturnRequestDialog from '@/components/borrow/ReturnRequestDialog';

// Extend Borrow type to include nested Equipment details we fetch
type BorrowWithEquipment = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images'>;
};

// Helper function to get badge color based on BorrowStatus
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

// Helper function to format BorrowStatus names
const formatBorrowStatus = (status: BorrowStatus) => {
  return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
};

export default function BorrowsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [borrows, setBorrows] = useState<BorrowWithEquipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingCancel, setLoadingCancel] = useState<string | null>(null); // Store ID of borrow being cancelled

  const fetchBorrows = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/borrows/my-borrows');
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please log in to view your borrows.'); // Should be handled by session status usually
        } else {
          throw new Error(`Failed to fetch borrows: ${response.statusText}`);
        }
      }
      const data: BorrowWithEquipment[] = await response.json();
      setBorrows(data);
    } catch (err) {
      console.error("Error fetching borrows:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch borrows only when session is loaded and authenticated
    if (sessionStatus === 'authenticated') {
      fetchBorrows();
    } else if (sessionStatus === 'unauthenticated') {
      setError('Please log in to view your borrows.');
      setIsLoading(false);
    }
    // If sessionStatus is 'loading', isLoading remains true
  }, [sessionStatus]);

  // Function to handle reservation cancellation
  const handleCancelReservation = async (borrowId: string) => {
    setLoadingCancel(borrowId);
    try {
      const response = await fetch(`/api/borrows/${borrowId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); 
        throw new Error(errorData.message || `Failed to cancel reservation: ${response.statusText}`);
      }

      // Option 1: Update status locally for immediate feedback
      // setBorrows(prevBorrows =>
      //   prevBorrows.map(b =>
      //     b.id === borrowId ? { ...b, borrowStatus: BorrowStatus.CANCELLED } : b
      //   )
      // );
      // Option 2: Refetch the data to ensure consistency
      fetchBorrows(); 

      toast.success('Reservation cancelled successfully.');

    } catch (err) {
      const message = err instanceof Error ? err.message : "An unknown error occurred while cancelling.";
      toast.error(message);
      console.error("Cancel Reservation Error:", err);
    } finally {
      setLoadingCancel(null);
    }
  };

  // --- Render Logic ---
  if (isLoading || sessionStatus === 'loading') {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-destructive py-10">
        <AlertCircle className="mx-auto h-12 w-12 mb-4" />
        <p className="text-lg">{error}</p>
        {/* Optionally add a login button if error is due to auth */}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-white">My Borrows</h1>
         <Button variant="outline" size="sm" onClick={fetchBorrows} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            Refresh
        </Button>
      </div>

      {borrows.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">You have no borrow records yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden border-border/60 bg-card/80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]"></TableHead><TableHead>Equipment</TableHead><TableHead>Status</TableHead><TableHead>Requested Dates</TableHead><TableHead>Actual Checkout</TableHead><TableHead>Expected Return</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {borrows.map((borrow) => {
                const imageUrl = borrow.equipment.images?.[0] || '/images/placeholder-default.png';
                const isCancelLoading = loadingCancel === borrow.id;
                // Explicit check for cancellable statuses
                const canCancel = borrow.borrowStatus === BorrowStatus.PENDING || borrow.borrowStatus === BorrowStatus.APPROVED;
                const canRequestReturn = borrow.borrowStatus === BorrowStatus.ACTIVE;

                return (
                  <TableRow key={borrow.id}>
                    <TableCell>
                        <Image 
                            src={imageUrl}
                            alt={borrow.equipment.name}
                            width={40}
                            height={40}
                            className="rounded object-cover aspect-square"
                        />
                    </TableCell>
                    <TableCell className="font-medium text-foreground truncate" title={borrow.equipment.name}>
                        {borrow.equipment.name}
                        {borrow.equipment.equipmentId && <span className="block text-xs text-muted-foreground">ID: {borrow.equipment.equipmentId}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getBorrowStatusVariant(borrow.borrowStatus)} className="capitalize whitespace-nowrap">
                        {formatBorrowStatus(borrow.borrowStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                       {format(new Date(borrow.requestedStartTime), 'PP')} - {format(new Date(borrow.requestedEndTime), 'PP')}
                    </TableCell>
                     <TableCell className="text-sm text-muted-foreground">
                        {borrow.checkoutTime ? format(new Date(borrow.checkoutTime), 'PPp') : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                         {borrow.approvedEndTime 
                           ? format(new Date(borrow.approvedEndTime), 'PPp') 
                           : '-'} 
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {canRequestReturn && session?.user?.id && (
                        <ReturnRequestDialog
                            borrowId={borrow.id}
                            userId={session.user.id}
                            equipmentName={borrow.equipment.name}
                            onReturnRequestSuccess={fetchBorrows}
                            triggerButton={
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  aria-label={`Request return for ${borrow.equipment.name}`}
                                >
                                   Request Return
                                </Button>
                            }
                        />
                      )}
                      {borrow.borrowStatus === BorrowStatus.PENDING_RETURN && (
                          <span className="text-sm text-info-foreground italic whitespace-nowrap">Pending Return</span>
                      )}
                      {canCancel && (
                         <Button 
                          variant="destructive" 
                          size="sm" 
                          onClick={() => handleCancelReservation(borrow.id)}
                          disabled={isCancelLoading}
                          aria-label={`Cancel reservation for ${borrow.equipment.name}`}
                        >
                           {isCancelLoading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                           {isCancelLoading ? 'Cancelling...' : 'Cancel'}
                        </Button>
                      )}
                     
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
} 