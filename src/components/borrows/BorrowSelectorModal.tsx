'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter, 
  DialogClose 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table";
import { columns as baseBorrowColumns, BorrowRequestAdminView } from "@/app/(app)/borrow-requests/columns";
import { ColumnDef } from "@tanstack/react-table";

interface BorrowSelectorModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onBorrowSelect: (borrowId: string) => void;
}

export default function BorrowSelectorModal({
  isOpen,
  onOpenChange,
  onBorrowSelect,
}: BorrowSelectorModalProps) {
  
  const [isLoading, setIsLoading] = useState(true);
  const [borrowRecords, setBorrowRecords] = useState<BorrowRequestAdminView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [borrowerFilter, setBorrowerFilter] = useState('');

  const fetchBorrowRecords = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/borrows/admin?status=ACTIVE&status=RETURNED&status=OVERDUE&status=COMPLETED');
      if (!response.ok) {
         const errorData = await response.json().catch(() => ({ error: "Failed to parse error response" }));
         throw new Error(errorData.error || `Failed to fetch borrow records: ${response.statusText}`);
      }
      const data: BorrowRequestAdminView[] = await response.json();
      setBorrowRecords(data);
    } catch (err) {
      console.error("Error fetching borrow records for modal:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      toast.error(`Error loading records: ${message}`);
      setBorrowRecords([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBorrowRecords();
      setEquipmentFilter('');
      setBorrowerFilter('');
    }
  }, [isOpen]);

  const filteredBorrowRecords = React.useMemo(() => {
    let filteredData = borrowRecords;
    if (equipmentFilter) {
      filteredData = filteredData.filter(record => 
        record.equipment?.name?.toLowerCase().includes(equipmentFilter.toLowerCase())
      );
    }
    if (borrowerFilter) {
      filteredData = filteredData.filter(record => 
        record.borrower?.name?.toLowerCase().includes(borrowerFilter.toLowerCase())
      );
    }
    return filteredData;
  }, [borrowRecords, equipmentFilter, borrowerFilter]);

  const modalColumns: ColumnDef<BorrowRequestAdminView>[] = [
    {
      id: 'select',
      header: 'Action',
      cell: ({ row }) => (
        <Button 
          variant="outline"
          size="sm"
          onClick={() => onBorrowSelect(row.original.id)}
        >
          Select
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    ...baseBorrowColumns.filter(col => col.id !== 'actions' && col.id !== 'select'), 
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-7xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Borrow Record</DialogTitle>
          <DialogDescription>
            Search and select the borrow record associated with the deficiency.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex items-center gap-4 py-4 px-1">
          <Input
            placeholder="Filter by equipment name..."
            value={equipmentFilter}
            onChange={(event) => setEquipmentFilter(event.target.value)}
            className="max-w-sm"
          />
          <Input
            placeholder="Filter by borrower name..."
            value={borrowerFilter}
            onChange={(event) => setBorrowerFilter(event.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="flex-grow overflow-auto border-t border-b">
          {isLoading ? (
            <div className="flex justify-center items-center h-full p-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/>
            </div>
          ) : error ? (
            <div className="text-center text-destructive p-10">Error loading records: {error}</div>
          ) : (
            <DataTable 
                columns={modalColumns} 
                data={filteredBorrowRecords}
            />
          )}
        </div>

        <DialogFooter className="pt-4">
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 