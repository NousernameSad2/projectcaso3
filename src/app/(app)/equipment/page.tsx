'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation'; // Import useRouter
import { Equipment, EquipmentCategory, EquipmentStatus, UserRole } from '@prisma/client';
import EquipmentCard from '@/components/equipment/EquipmentCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button'; 
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Calendar as CalendarIcon, FilterX, PlusCircle, Clock } from "lucide-react"
import { format, formatISO, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns"
import { DateRange } from "react-day-picker"
// import ReservationModal from '@/components/equipment/ReservationModal'; // Removed ReservationModal
// import BulkCheckoutModal from '@/components/equipment/BulkCheckoutModal'; // Removed BulkCheckoutModal
// import BulkEditStatusModal from '@/components/equipment/BulkEditStatusModal'; // <<< Import already removed
import BulkReservationModal from '@/components/equipment/BulkReservationModal';
import Link from 'next/link'; // Keep Link
import { toast } from 'sonner'; // Keep toast

// Update EquipmentWithCount to include new fields from the API
interface EquipmentWithCount extends Equipment {
  _count: { 
    borrowRecords: number;
  };
  nextUpcomingReservationStart: string | null; // Added from API
  availableUnitsInFilterRange: number | null;  // Added from API
  activeBorrowCount: number; // Added from API
}

// Define category options including 'ALL'
const categoryOptions = [
  { value: 'ALL', label: 'All Categories' },
  ...Object.values(EquipmentCategory).map(cat => ({ value: cat, label: (cat as string).replace(/_/g, ' ') })),
];

// Define status options including 'ALL'
const statusOptions = [
  { value: 'ALL', label: 'All Statuses' },
  ...Object.values(EquipmentStatus).map(stat => ({ value: stat, label: (stat as string).replace(/_/g, ' ') })),
];

export default function EquipmentPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  // Use EquipmentWithCount
  const [equipmentList, setEquipmentList] = useState<EquipmentWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('AVAILABLE'); 

  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>("00:00");
  const [endTime, setEndTime] = useState<string>("23:59");

  const [appliedDateRange, setAppliedDateRange] = useState<DateRange | undefined>(undefined);
  const [appliedStartTime, setAppliedStartTime] = useState<string>("00:00");
  const [appliedEndTime, setAppliedEndTime] = useState<string>("23:59");

  // State for multi-selection and modals (Keep for now)
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);

  // Fetch equipment data from API - Wrapped in useCallback
  const fetchEquipment = useCallback(async (
    search = searchTerm, 
    category = selectedCategory, 
    status = selectedStatus, 
    dates = appliedDateRange,
    sTime = appliedStartTime,
    eTime = appliedEndTime
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category && category !== 'ALL') params.set('category', category);
      if (status && status !== 'ALL') params.set('status', status);
      
      if (dates?.from && dates?.to && sTime && eTime) {
        try {
          const [sHours, sMinutes] = sTime.split(':').map(Number);
          const [eHours, eMinutes] = eTime.split(':').map(Number);

          const startDateTime = setMilliseconds(setSeconds(setMinutes(setHours(dates.from, sHours), sMinutes),0),0);
          const endDateTime = setMilliseconds(setSeconds(setMinutes(setHours(dates.to, eHours), eMinutes),59),999);
          
          params.set('startDate', formatISO(startDateTime));
          params.set('endDate', formatISO(endDateTime));
        } catch (e) {
          console.error("Error parsing time for API request:", e);
          if (dates.from) params.set('startDate', format(dates.from, 'yyyy-MM-dd'));
          if (dates.to) params.set('endDate', format(dates.to, 'yyyy-MM-dd'));
        }
      } else if (dates?.from) {
        params.set('startDate', format(dates.from, 'yyyy-MM-ddT00:00:00.000Z'));
      } else if (dates?.to) {
         params.set('endDate', format(dates.to, 'yyyy-MM-ddT23:59:59.999Z'));
      }

      const response = await fetch(`/api/equipment?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch equipment: ${response.statusText}`);
      }
      const data = await response.json();
      // Expect EquipmentWithCount from API
      setEquipmentList(data.items || []);
    } catch (err: unknown) {
      console.error("Error fetching equipment:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      setEquipmentList([]);
    } finally {
      setIsLoading(false);
    }
  }, [setEquipmentList, setError, setIsLoading, searchTerm, selectedCategory, selectedStatus, appliedDateRange, appliedStartTime, appliedEndTime]);

  // Initial fetch and refetch on filter changes
  useEffect(() => {
    fetchEquipment(searchTerm, selectedCategory, selectedStatus, appliedDateRange, appliedStartTime, appliedEndTime);
  }, [searchTerm, selectedCategory, selectedStatus, appliedDateRange, appliedStartTime, appliedEndTime, fetchEquipment]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
  };

  const handleStatusChange = (value: string) => {
    setSelectedStatus(value);
  };

  const handleApplyDateFilter = () => {
    setAppliedDateRange(dateRange);
    setAppliedStartTime(startTime);
    setAppliedEndTime(endTime);
  };

  const handleClearDateFilter = () => {
    setDateRange(undefined);
    setStartTime("00:00");
    setEndTime("23:59");
    setAppliedDateRange(undefined);
    setAppliedStartTime("00:00");
    setAppliedEndTime("23:59");
  };

  // --- Toggle selection handler ---
  const handleSelectToggle = (id: string) => {
    setSelectedEquipmentIds((prevSelected) =>
      prevSelected.includes(id)
        ? prevSelected.filter((selectedId) => selectedId !== id)
        : [...prevSelected, id]
    );
  };

  // --- Function to clear selection ---
  const clearSelection = () => {
    setSelectedEquipmentIds([]);
  };

  // Open Reservation Modal (for single item from card)
  // const openReservationModal = (equipment: Equipment) => {
  //   setSelectedEquipmentForReservation(equipment);
  //   setIsReservationModalOpen(true);
  // };

  // Handler for successful SINGLE item reservation from modal
  // const handleReservationSuccess = () => {
  //   toast.success("Reservation request submitted!");
  //   setIsReservationModalOpen(false);
  //   setSelectedEquipmentForReservation(null);
  //   clearSelection(); // Clear bulk selection if single was reserved
  // };

  // --- Handlers for Bulk Modals ---
  const handleOpenBulkCheckout = () => {
     if (selectedEquipmentIds.length === 0) return;
     // setIsBulkCheckoutModalOpen(true);
  };
  // const handleBulkCheckoutSuccess = () => {
  //    console.log("Bulk checkout successful");
  //    clearSelection();
  //    toast.success('Items checked out successfully!');
  //    setIsBulkCheckoutModalOpen(false);
  //    fetchEquipment(); // Refetch data
  // };

  // Handler for opening bulk reservation modal - RE-ADD
  // const handleOpenBulkReserve = () => {
  //   if (selectedEquipmentIds.length < 2) return; 
  //   setIsBulkReservationModalOpen(true);
  // };

  // Handler for successful bulk reservation (modal closes itself)
  const handleBulkReservationSuccess = (borrowGroupId: string) => {
    console.log("Bulk reservation successful, group ID:", borrowGroupId);
    clearSelection();
    toast.success('Bulk reservation request submitted successfully!');
    // Optionally refetch data or navigate
    // fetchEquipment();
  };

  const handleOpenBulkStatus = () => {
     if (selectedEquipmentIds.length === 0) return;
     // setIsBulkStatusModalOpen(true);
  };
  // const handleBulkStatusSuccess = () => {
  //    console.log("Bulk status update successful");
  //    clearSelection();
  //    toast.success('Equipment statuses updated successfully!');
  //    setIsBulkStatusModalOpen(false);
  //    fetchEquipment(); // Refetch data
  // };

  // Check user permissions and authentication status
  const isAuthenticated = sessionStatus === 'authenticated';
  const canManageEquipment = isAuthenticated && !!session?.user && (session.user.role === UserRole.STAFF || session.user.role === UserRole.FACULTY);
  const hasSelection = selectedEquipmentIds.length > 0;

  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push('/auth/signin');
    }
  }, [sessionStatus, router]);

  // ... Session status checks and return ...
  if (sessionStatus === "loading") {
    return <div className="flex justify-center items-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>;
  }
  if (sessionStatus === "unauthenticated") {
     // router.push('/auth/signin'); // Moved to useEffect
     return <div className="flex justify-center items-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>; // Still return loading or null while redirecting
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-8">
        <h1 style={{ color: 'hsl(var(--foreground))' }} className="text-3xl font-bold">Equipment Catalog</h1>
        <p className="text-muted-foreground mt-1">
          Browse, search, and manage all available equipment.
        </p>
      </div>
      {/* Filters Section */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <Input
          placeholder="Search equipment..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="bg-card border-border/40 placeholder:text-muted-foreground"
        />
        <Select value={selectedCategory} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-full bg-card border-border/40 text-foreground">
            <SelectValue placeholder="Select Category" />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedStatus} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full bg-card border-border/40 text-foreground">
            <SelectValue placeholder="Select Status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        {/* Date Range Picker UI */}
        <div className="space-y-2 col-span-1 md:col-span-2 lg:col-span-1">
           <label className="text-sm font-medium text-muted-foreground">Filter by Availability</label>
           <Popover>
             <PopoverTrigger asChild>
               <Button
                 id="date"
                 variant={"outline"}
                 className={cn(
                   "w-full justify-start text-left font-normal bg-card border-border/40 hover:bg-muted/20",
                   !dateRange && "text-muted-foreground"
                 )}
               >
                 <CalendarIcon className="mr-2 h-4 w-4" />
                 {dateRange?.from ? (
                   dateRange.to ? (
                     <>
                       {format(dateRange.from, "LLL dd, y")} -{" "}
                       {format(dateRange.to, "LLL dd, y")}
                     </>
                   ) : (
                     format(dateRange.from, "LLL dd, y")
                   )
                 ) : (
                   <span>Pick a date range</span>
                 )}
               </Button>
             </PopoverTrigger>
             <PopoverContent className="w-auto p-0 bg-card border-border" align="start">
               <Calendar
                 initialFocus
                 mode="range"
                 defaultMonth={dateRange?.from}
                 selected={dateRange}
                 onSelect={setDateRange}
                 numberOfMonths={1}
               />
             </PopoverContent>
           </Popover>
           <div className="flex gap-2 items-center">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Input 
                type="time" 
                value={startTime} 
                onChange={(e) => setStartTime(e.target.value)} 
                className="w-full bg-card border-border/40 h-9 text-sm"
                disabled={!dateRange?.from}
            />
            <span className="text-muted-foreground">-</span>
            <Input 
                type="time" 
                value={endTime} 
                onChange={(e) => setEndTime(e.target.value)} 
                className="w-full bg-card border-border/40 h-9 text-sm"
                disabled={!dateRange?.to}
            />
           </div>
           <div className="flex gap-2 mt-1">
            <Button onClick={handleApplyDateFilter} className="w-full" size="sm" disabled={!dateRange?.from || !dateRange?.to}>Apply Dates</Button>
            {(appliedDateRange?.from || appliedDateRange?.to) && (
                 <Button onClick={handleClearDateFilter} variant="outline" className="w-full" size="sm">
                    <FilterX className="mr-1 h-3 w-3"/> Clear
                 </Button>
            )}
           </div>
        </div>
      </div>
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4 mb-4 border-border/20">
        <div className="flex items-center gap-2 flex-wrap">
           {/* Bulk Actions - Show only when items are selected */}
           {hasSelection && (
             <>
               <span className="text-sm text-muted-foreground mr-2">
                 {selectedEquipmentIds.length} item(s) selected
               </span>
               {/* Bulk Reserve Button (All users) - Now wrapped by Modal Trigger */} 
               {/* The Modal component will render the trigger button */} 

               {/* Bulk Checkout Button (Staff/Faculty only) */}
               {canManageEquipment && (
                  <Button size="sm" variant="outline" onClick={handleOpenBulkCheckout}>Bulk Checkout</Button>
               )}
               {/* Bulk Edit Status Button (Staff/Faculty only) */}
               {canManageEquipment && (
                   <Button size="sm" variant="outline" onClick={handleOpenBulkStatus}>Bulk Edit Status</Button>
               )}
               {/* Bulk Reservation Modal & Trigger (shown if >= 1 item selected) */}
               {selectedEquipmentIds.length >= 1 && (
                 <BulkReservationModal
                   selectedEquipmentIds={selectedEquipmentIds}
                   onReservationSuccess={handleBulkReservationSuccess}
                   onClose={clearSelection} // Clear selection if modal is closed without success
                   triggerButton={
                     <Button 
                       size="sm" 
                       variant="outline" 
                       // No disabled prop needed here as parent condition handles it
                     >
                       Bulk Reserve
                     </Button>
                   }
                 />
               )}
               <Button size="sm" variant="secondary" onClick={clearSelection}>Clear Selection</Button>
             </>
           )}

           {/* Add Equipment Button - Show when NO items selected AND user is Staff/Faculty */} 
           {!hasSelection && canManageEquipment && (
             <Button size="sm" asChild>
               <Link href="/equipment/new">
                 <>
                   <PlusCircle className="mr-2 h-4 w-4" /> Add Equipment
                 </>
               </Link>
             </Button>
           )}
        </div>
      </div>
      {/* Equipment Grid */}
      {isLoading ? (
        <div className="flex justify-center items-center min-h-[40vh]">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center text-destructive py-10">Error: {error}</div>
      ) : equipmentList.length === 0 ? (
         <div className="text-center text-muted-foreground py-10">
            No equipment found matching your criteria.
         </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {equipmentList.map((item) => (
            <EquipmentCard 
              key={item.id} 
              equipment={item} 
              isSelected={selectedEquipmentIds.includes(item.id)} 
              onSelectToggle={handleSelectToggle} 
              isDateFilterActive={!!appliedDateRange}
              canSelect={isAuthenticated}
              canManageEquipment={canManageEquipment}
            />
          ))}
        </div>
      )}
      {/* Modals (Temporarily commented out to fix type errors) */}
      {/* {isReservationModalOpen && selectedEquipmentForReservation && (
         <ReservationModal
            isOpen={isReservationModalOpen}
            setIsOpen={setIsReservationModalOpen}
            equipment={selectedEquipmentForReservation}
            onSuccess={handleReservationSuccess}
         />
      )} */}
      {/* {isBulkCheckoutModalOpen && (
         <BulkCheckoutModal
           isOpen={isBulkCheckoutModalOpen}
           setIsOpen={setIsBulkCheckoutModalOpen}
           selectedEquipmentIds={selectedEquipmentIds}
           onSuccess={handleBulkCheckoutSuccess} 
         />
      )} */}
      {/* {isBulkStatusModalOpen && canManageEquipment && (
        <BulkEditStatusModal
           isOpen={isBulkStatusModalOpen}
           setIsOpen={setIsBulkStatusModalOpen}
           selectedEquipmentIds={selectedEquipmentIds}
           onSuccess={handleBulkStatusSuccess} 
         />
       )} */}
      {/* BulkReservationModal is now rendered conditionally inline above */}
    </div>
  );
} 