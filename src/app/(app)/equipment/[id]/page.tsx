'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Equipment, EquipmentStatus, EquipmentCategory, Borrow, BorrowStatus, UserRole, Prisma, Deficiency, DeficiencyType, User, Class, ReservationType } from '@prisma/client';
import { useSession } from 'next-auth/react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ArrowLeft, Edit, Trash2, Loader2, CalendarDays, AlertCircle, Wrench, History, PackagePlus, ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle, MessageSquare, User as UserIcon, School } from 'lucide-react';
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ReservationModal from '@/components/equipment/ReservationModal';
import { Calendar } from "@/components/ui/calendar";
import { addDays, eachDayOfInterval, startOfDay, isSameDay, format, isValid } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

// Extended Borrow interface for detailed views
interface BorrowWithDetails extends Borrow {
  borrower: User;
  approvedByFic: User | null;
  approvedByStaff: User | null;
  class: Pick<Class, 'id' | 'courseCode' | 'section'> | null;
  deficiencies?: Pick<Deficiency, 'type' | 'description'>[]; // Add deficiencies
  checkoutTime: Date | null;
  actualReturnTime: Date | null;
  reservationType: ReservationType | null;
}

// Extended Equipment interface including counts and related records
interface EquipmentWithDetails extends Equipment {
  _count?: {
    borrowRecords?: number;
    // NOTE: maintenanceLog count is not provided here by the API in this structure
  };
  borrowRecords?: BorrowWithDetails[]; // Use updated Borrow type
  maintenanceLog: Prisma.JsonValue[]; // Maintenance logs are directly on the object
  editHistory: Prisma.JsonValue[];
  customNotesLog: Prisma.JsonValue[]; // Add the new field
}

// Define interface for booking data fetched from API
interface BookingData {
    id: string;
    requestedStartDate: string | Date; // API might return string
    expectedReturnTime: string | Date;
    borrowStatus: BorrowStatus;
}

// Interface for recent borrow data
interface RecentBorrowData {
    id: string;
    actualReturnTime: string | Date;
    borrower: {
        id: string;
        name: string | null;
        email: string | null;
    };
}

// Interface for unified Activity Log entries
interface ActivityLogEntry {
  timestamp: Date;
  type: 'CREATED' | 'BORROW_REQUEST' | 'BORROW_APPROVED' | 'BORROW_REJECTED' | 'BORROW_CHECKOUT' | 'BORROW_RETURN' | 'BORROW_COMPLETED' | 'MAINTENANCE' | 'EDIT';
  details: React.ReactNode; // Use ReactNode for flexible rendering
  user?: { name: string | null; email: string | null }; // Optional user associated with the event
}

// Define interface for custom notes (optional, but good for type safety)
interface CustomNote {
  timestamp: string | Date;
  userId: string;
  userDisplay: string;
  text: string;
}

// Helper function for safe date formatting
const safeFormatDate = (dateInput: string | Date | null | undefined, formatString: string): string => {
  if (!dateInput) return 'N/A';
  try {
    const date = new Date(dateInput);
    // Use date-fns isValid for better check
    if (!isValid(date)) return 'Invalid Date'; 
    return format(date, formatString);
  } catch (error) {
    console.error("Date formatting error:", error);
    return 'Invalid Date';
  }
};

// Helper function to get badge color based on status (reuse or import)
const getStatusVariant = (status: EquipmentStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case EquipmentStatus.AVAILABLE: return "success";
    case EquipmentStatus.BORROWED: case EquipmentStatus.RESERVED: return "secondary";
    case EquipmentStatus.UNDER_MAINTENANCE: return "warning";
    case EquipmentStatus.DEFECTIVE: case EquipmentStatus.OUT_OF_COMMISSION: return "destructive";
    default: return "default";
  }
};

// Helper function to format category names (reuse or import)
const formatCategory = (category: EquipmentCategory) => {
  switch (category) {
    case EquipmentCategory.INSTRUMENTS: return 'Instruments';
    case EquipmentCategory.ACCESSORIES: return 'Accessories';
    case EquipmentCategory.TOOLS: return 'Tools';
    case EquipmentCategory.CONSUMABLES: return 'Consumables';
    case EquipmentCategory.OTHER: return 'Other';
    default: return category;
  }
};

// Helper function to format status text
const formatStatusText = (status: EquipmentStatus) => {
  return status.toLowerCase().replace('_', ' ');
};

// Helper function to format duration in seconds to H:M:S string
const formatDuration = (totalSeconds: number): string => {
  if (totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`); // Show seconds if non-zero or if H/M are zero

  return parts.join(' ');
};

// Helper: Get badge variant for borrow status (reuse from borrows page if possible)
const getBorrowStatusVariant = (status: BorrowStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case BorrowStatus.PENDING: return "warning";
    case BorrowStatus.APPROVED: return "secondary";
    case BorrowStatus.ACTIVE: return "success";
    case BorrowStatus.PENDING_RETURN: return "secondary"; // Use secondary for PENDING_RETURN
    case BorrowStatus.RETURNED: case BorrowStatus.COMPLETED: return "default"; // Use default for RETURNED/COMPLETED
    case BorrowStatus.REJECTED_FIC: case BorrowStatus.REJECTED_STAFF: case BorrowStatus.CANCELLED: return "destructive";
    case BorrowStatus.OVERDUE: return "destructive";
    default: return "default";
  }
};

// Helper: Format borrow status (reuse from borrows page if possible)
const formatBorrowStatus = (status: BorrowStatus) => {
  return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// *** NEW: Helpers for Reservation Type Display ***
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'In Class' : 'Out of Class';
};
const getReservationTypeVariant = (type: ReservationType | null | undefined): "success" | "destructive" | "secondary" => {
    if (!type) return 'secondary';
    return type === 'IN_CLASS' ? 'success' : 'destructive';
};

export default function EquipmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = params.id as string;

  const [equipment, setEquipment] = useState<EquipmentWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [unavailableDates, setUnavailableDates] = useState<Date[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [bookingError, setBookingError] = useState<string | null>(null);
  
  // Add state for the calendar's displayed month
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  
  const [recentBorrows, setRecentBorrows] = useState<RecentBorrowData[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  
  // State for the new custom note input
  const [newNoteText, setNewNoteText] = useState<string>("");
  const [isSubmittingNote, setIsSubmittingNote] = useState<boolean>(false);
  
  // Add state to track which note is being deleted
  const [isDeletingNote, setIsDeletingNote] = useState<string | null>(null); // Store timestamp of note being deleted
  
  // Calculate Net Contact Hours (now returns formatted string)
  const netContactHoursFormatted = useMemo(() => {
    if (!equipment?.borrowRecords) {
      return '0s'; // Default to 0 seconds if no records
    }

    // Include both RETURNED and COMPLETED statuses
    const finishedStatuses: BorrowStatus[] = [BorrowStatus.RETURNED, BorrowStatus.COMPLETED];
    const finishedRecords = equipment.borrowRecords.filter(
      (record) => finishedStatuses.includes(record.borrowStatus)
    );

    let totalSeconds = 0;
    finishedRecords.forEach((record) => {
      if (record.checkoutTime && record.actualReturnTime) {
        const checkout = new Date(record.checkoutTime);
        const returned = new Date(record.actualReturnTime);
        
        // Basic validity check
        if (!isNaN(checkout.getTime()) && !isNaN(returned.getTime()) && returned > checkout) {
          const durationMs = returned.getTime() - checkout.getTime();
          totalSeconds += durationMs / 1000; // Accumulate seconds
        } else {
          // Log unexpected cases for COMPLETED records
          console.warn(`Invalid dates for completed borrow record ${record.id}: checkout=${record.checkoutTime}, return=${record.actualReturnTime}`);
        }
      }
    });

    return formatDuration(totalSeconds); // Use the helper function

  }, [equipment?.borrowRecords]);

  // Find the latest maintenance log entry notes
  const latestMaintenanceNote = useMemo(() => {
    if (!equipment?.maintenanceLog || equipment.maintenanceLog.length === 0) {
      return null;
    }
    // Assuming logs are pushed chronologically, the last one is the latest.
    // If logs could be out of order, we'd need to sort by timestamp first.
    const latestLog = equipment.maintenanceLog[equipment.maintenanceLog.length - 1] as any;
    return latestLog?.notes || null; // Return notes or null if notes field is missing/empty
  }, [equipment?.maintenanceLog]);

  // Sort borrow records for the history panel (most recent first)
  const sortedBorrowRecords = useMemo(() => {
    if (!equipment?.borrowRecords) return [];
    // Sort by requestSubmissionTime descending
    return [...equipment.borrowRecords].sort((a, b) => { 
        const dateA = a.requestSubmissionTime ? new Date(a.requestSubmissionTime).getTime() : 0;
        const dateB = b.requestSubmissionTime ? new Date(b.requestSubmissionTime).getTime() : 0;
        return dateB - dateA; // Newest first
    });
  }, [equipment?.borrowRecords]);

  // Need fetchEquipmentDetail accessible for refresh
  const fetchEquipmentDetail = useMemo(() => async () => {
    if (!id) return;
    // Keep original setIsLoading outside if it controls the whole page
    // setIsFetching(true); // Use a different loading state? Or maybe not needed if submit button handles it
    // setError(null);
    try {
      const response = await fetch(`/api/equipment/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Equipment not found');
        } else {
          throw new Error(`Failed to fetch equipment: ${response.statusText}`);
        }
      }
      const data: EquipmentWithDetails = await response.json();
      data.maintenanceLog = Array.isArray(data.maintenanceLog) ? data.maintenanceLog : [];
      data.editHistory = Array.isArray(data.editHistory) ? data.editHistory : [];
      data.customNotesLog = Array.isArray(data.customNotesLog) ? data.customNotesLog : [];
      setEquipment(data);
    } catch (err: unknown) {
      console.error("Error fetching equipment detail:", err);
      // Type check added
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(message);
      // setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      // setIsFetching(false);
    }
  }, [id]); // Dependency array for useMemo

  // Initial fetch effect
  useEffect(() => {
    setIsLoading(true); // Main page loading
    fetchEquipmentDetail().finally(() => setIsLoading(false));
  }, [fetchEquipmentDetail]); // Depend on the memoized function

  useEffect(() => {
    if (!id) return;
    const fetchBookings = async () => {
        setIsLoadingBookings(true);
        setBookingError(null);
        try {
            const response = await fetch(`/api/equipment/${id}/bookings`);
            if (!response.ok) {
                throw new Error('Failed to fetch availability data');
            }
            const data: string[] = await response.json();
            const bookedDates = data.map(dateStr => {
                const date = new Date(`${dateStr}T00:00:00`); 
                return startOfDay(date);
              }).filter(date => !isNaN(date.getTime()));
            setUnavailableDates(bookedDates);
            // Set initial calendar month based on first unavailable date or today
            setCalendarMonth(bookedDates.length > 0 ? bookedDates[0] : new Date());
        } catch (err) {
            console.error("Error fetching availability:", err);
            setBookingError(err instanceof Error ? err.message : "Could not load availability");
        } finally {
            setIsLoadingBookings(false);
        }
    };
    fetchBookings();
  }, [id]);

  useEffect(() => {
      if (!id) return;
      const fetchRecent = async () => {
          setIsLoadingRecent(true);
          setRecentError(null);
          try {
              const response = await fetch(`/api/equipment/${id}/recent-borrows`);
              if (!response.ok) {
                  throw new Error('Failed to fetch recent borrows');
              }
              const data = await response.json();
              setRecentBorrows(data as RecentBorrowData[]);
          } catch (err) {
              console.error("Error fetching recent borrows:", err);
              setRecentError(err instanceof Error ? err.message : "Could not load recent borrows");
          } finally {
              setIsLoadingRecent(false);
          }
      };
      fetchRecent();
  }, [id]);

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/equipment/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
         let message = 'Failed to delete equipment';
         try {
           const errorData = await response.json();
           message = errorData.message || message;
         } catch (_) {}
         throw new Error(message);
      }
      
      console.log("Equipment deleted successfully");
      toast.success("Equipment deleted successfully!");
      router.push('/equipment');

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(errorMessage);
      console.error("Delete Equipment Error:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReservationSuccess = () => {
    toast.success("Reservation submitted successfully!");
    fetchEquipmentDetail(); // Refresh details after reservation
  };

  // useMemo hook to process and sort activity log entries
  const sortedLogEntries = useMemo(() => {
    if (!equipment) return [];

    const logEntries: ActivityLogEntry[] = [];

    // 1. Add Equipment Creation Date (if available)
    if (equipment.createdAt) {
    logEntries.push({
      timestamp: new Date(equipment.createdAt),
      type: 'CREATED',
      details: 'Equipment record created.'
    });
    }

    // 2. Process Borrow Records
    equipment.borrowRecords?.forEach(borrow => {
      // Borrow Request - Use requestSubmissionTime
      logEntries.push({
        timestamp: new Date(borrow.requestSubmissionTime),
        type: 'BORROW_REQUEST',
        user: borrow.borrower,
        details: `Requested by ${borrow.borrower?.name || borrow.borrower?.email || 'Unknown'} for ${safeFormatDate(borrow.requestedStartTime, 'Pp')} - ${safeFormatDate(borrow.requestedEndTime, 'Pp')}`
      });
      
      // --- Add Approval Logs ---
      if (borrow.approvedByFic) {
        logEntries.push({
          timestamp: new Date(borrow.updatedAt || borrow.requestSubmissionTime), 
          type: 'BORROW_APPROVED', 
          user: borrow.approvedByFic, // User who approved
          details: `Approved by FIC: ${borrow.approvedByFic.name || borrow.approvedByFic.email || 'Unknown'}. Scheduled: ${safeFormatDate(borrow.approvedStartTime, 'Pp')} - ${safeFormatDate(borrow.approvedEndTime, 'Pp')}`
        });
      }
      if (borrow.approvedByStaff) {
         logEntries.push({
          timestamp: new Date(borrow.updatedAt || borrow.requestSubmissionTime), 
          type: 'BORROW_APPROVED', 
          user: borrow.approvedByStaff, // User who approved
          details: `Approved by Staff: ${borrow.approvedByStaff.name || borrow.approvedByStaff.email || 'Unknown'}. Scheduled: ${safeFormatDate(borrow.approvedStartTime, 'Pp')} - ${safeFormatDate(borrow.approvedEndTime, 'Pp')}`
        });
      }
      // --- Add Rejection Logs ---
      if (borrow.borrowStatus === BorrowStatus.REJECTED_FIC) {
        logEntries.push({
          // Use updatedAt as the best guess for event time
          timestamp: new Date(borrow.updatedAt || borrow.requestSubmissionTime),
          type: 'BORROW_REJECTED',
          user: undefined, // Cannot know who rejected from data model
          details: `Rejected by FIC.` // Add remarks if available later
        });
      }
      if (borrow.borrowStatus === BorrowStatus.REJECTED_STAFF) {
         logEntries.push({
          // Use updatedAt as the best guess for event time
          timestamp: new Date(borrow.updatedAt || borrow.requestSubmissionTime),
          type: 'BORROW_REJECTED',
          user: undefined, // Cannot know who rejected from data model
          details: `Rejected by Staff.` // Add remarks if available later
        });
      }
      
      // Checkout
      if (borrow.checkoutTime) {
        logEntries.push({
          timestamp: new Date(borrow.checkoutTime),
          type: 'BORROW_CHECKOUT',
          user: borrow.borrower,
          details: `Checked out by ${borrow.borrower?.name || borrow.borrower?.email || 'Unknown'}. Expected return: ${safeFormatDate(borrow.approvedEndTime || borrow.requestedEndTime, 'PP')}`
        });
      }
      // Return
      if (borrow.actualReturnTime) {
        // Use more descriptive fallbacks instead of 'N/A'
        const conditionText = borrow.returnCondition || 'Condition not specified';
        const remarksText = borrow.returnRemarks || 'No remarks provided';
        let detailsString = `Returned by ${borrow.borrower?.name || borrow.borrower?.email || 'Unknown'}. Condition: ${conditionText}. Remarks: ${remarksText}`;
        
        // Check for deficiencies
        if (borrow.deficiencies && borrow.deficiencies.length > 0) {
          const deficiencySummary = borrow.deficiencies
            .map(d => `${d.type}${d.description ? ": " + d.description : ''}`)
            .join(', ');
          detailsString += ` <span class="text-destructive font-medium">(Deficiencies: ${deficiencySummary})</span>`;
        }

        logEntries.push({
          timestamp: new Date(borrow.actualReturnTime),
          type: 'BORROW_RETURN',
          user: borrow.borrower,
          details: <span dangerouslySetInnerHTML={{ __html: detailsString }} /> 
        });
      }
       // Completion (You might have a separate completedAt or use actualReturnTime)
      if (borrow.borrowStatus === BorrowStatus.COMPLETED && borrow.actualReturnTime) {
         logEntries.push({
           timestamp: new Date(borrow.actualReturnTime),
           type: 'BORROW_COMPLETED',
           user: borrow.borrower,
           details: `Borrow cycle completed.`
         });
      }
      // Add entries for REJECTED_FIC, REJECTED_STAFF etc. if relevant timestamps/actors exist
    });

    // 3. Process Maintenance Log (with defensive checks)
    equipment.maintenanceLog?.forEach((logItem) => {
      const log = logItem as any; 
      if (log && typeof log === 'object' && log.timestamp && typeof log.timestamp === 'string') { 
        try {
          const timestamp = new Date(log.timestamp);
          if (isValid(timestamp)) { 
            // Use more descriptive fallbacks
            const notesText = log.notes || 'No notes provided';
            const userText = log.user || 'User not specified'; 
            // Simplify log.type usage assuming 'MAINTENANCE' is standard from our PUT logic
            // If other types exist, this might need adjustment
            const maintenanceType = log.type === 'MAINTENANCE' ? 'Maintenance' : (log.type || 'Maintenance Event'); 
            logEntries.push({
              timestamp: timestamp,
              type: 'MAINTENANCE',
              details: `${maintenanceType}. Notes: ${notesText}. By: ${userText}`,
            });
          } else {
             console.warn("Skipping invalid maintenance log timestamp:", log.timestamp);
          }
        } catch (e) {
          console.warn("Error processing maintenance log timestamp:", log.timestamp, e);
        }
      }
    });

    // 4. Process Edit History (with defensive checks)
    equipment.editHistory?.forEach((logItem) => {
      const log = logItem as any;
      if (log && typeof log === 'object' && log.timestamp && typeof log.timestamp === 'string') { 
        try {
          const timestamp = new Date(log.timestamp);
          if (isValid(timestamp)) { 
             const changes = Array.isArray(log.changes) ? log.changes : [];
             const changesStr = changes.map((c: any) => `${c.field} changed from \"${c.oldValue}\" to \"${c.newValue}\"`).join('; ') || 'Details updated';
             // Use more descriptive fallback for user
             const userText = log.user || 'User not specified';
             logEntries.push({
               timestamp: timestamp,
               type: 'EDIT',
               details: `${changesStr}. By: ${userText}`,
             });
           } else {
               console.warn("Skipping invalid edit log timestamp:", log.timestamp);
           }
        } catch (e) {
          console.warn("Error processing edit log timestamp:", log.timestamp, e);
        }
      }
    });

    // 5. Sort all entries by timestamp, newest first
    logEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return logEntries;

  }, [equipment]);

  // Define modifiers for the calendar
  const modifiers = {
    booked: unavailableDates, // Pass the array of Date objects
    today: new Date(), // Add a modifier for today
  };

  // Define styles for the modifiers
  const modifiersStyles = {
    booked: {
      // Example: Style booked dates with a red background (using theme colors if possible)
      backgroundColor: 'hsl(var(--destructive) / 0.2)', // Use destructive color with opacity
      // color: 'hsl(var(--destructive-foreground))', // Optional: Change text color
      borderRadius: 'var(--radius)', // Use theme radius
    },
    today: {
        // Example: Style today with an accent border
        border: '2px solid hsl(var(--accent-foreground))', 
        fontWeight: 'bold',
    }
  };

  // Function to handle submitting a new note
  const handleNoteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newNoteText.trim() || !id) return;

    setIsSubmittingNote(true);
    try {
      const response = await fetch(`/api/equipment/${id}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ noteText: newNoteText }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to add note');
      }

      toast.success('Note added successfully!');
      setNewNoteText(""); // Clear input field
      fetchEquipmentDetail(); // Refresh equipment details to show the new note
    } catch (err: unknown) {
      console.error('Error adding note:', err);
      // Type check added
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(message);
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // --- NEW: Function to handle deleting a note ---
  const handleDeleteNote = async (noteTimestamp: string) => {
    if (!id || !noteTimestamp) return;

    setIsDeletingNote(noteTimestamp); // Set the timestamp of the note being deleted

    try {
      // Important: Encode the timestamp for the URL
      const encodedTimestamp = encodeURIComponent(noteTimestamp);
      const response = await fetch(`/api/equipment/${id}/notes/${encodedTimestamp}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete note');
      }

      toast.success('Note deleted successfully!');
      fetchEquipmentDetail(); // Refresh equipment details to remove the note
    } catch (err: unknown) {
      console.error('Error deleting note:', err);
      // Type check added
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(`Error deleting note: ${message}`);
    } finally {
      setIsDeletingNote(null); // Reset deleting state regardless of outcome
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-destructive py-10">
        <p>Error: {error}</p>
        <Button variant="outline" onClick={() => router.back()} className="mt-4">Go Back</Button>
      </div>
    );
  }

  if (!equipment) {
    return <div className="text-center text-muted-foreground py-10">Equipment not found.</div>;
  }
  
  const canManage = session?.user?.role === UserRole.STAFF || session?.user?.role === UserRole.FACULTY;

  // Calculate Effective Status (prioritizing terminal and RESERVED statuses)
  let effectiveStatus: EquipmentStatus = equipment.status; // Default to stored status
  if (
    equipment.status === EquipmentStatus.UNDER_MAINTENANCE ||
    equipment.status === EquipmentStatus.DEFECTIVE ||
    equipment.status === EquipmentStatus.OUT_OF_COMMISSION
  ) {
    effectiveStatus = equipment.status; // Use terminal status directly
  } else if (equipment.status === EquipmentStatus.RESERVED) {
    effectiveStatus = EquipmentStatus.RESERVED; // Prioritize RESERVED
  } else {
    // If not terminal or reserved, check stock vs active borrows
    const activeBorrows = equipment._count?.borrowRecords ?? 0; 
    if (activeBorrows >= equipment.stockCount) {
      effectiveStatus = EquipmentStatus.BORROWED; 
    } else {
      effectiveStatus = EquipmentStatus.AVAILABLE; // Must be available
    }
  }

  // Use effectiveStatus for the badge
  const statusVariant = getStatusVariant(effectiveStatus);
  // const isAvailable = effectiveStatus === EquipmentStatus.AVAILABLE; // Already defined in EquipmentCard if needed here

  // Helper to get icon based on log type
  const getLogIcon = (type: ActivityLogEntry['type']) => {
    switch (type) {
      case 'CREATED': return <PackagePlus className="h-4 w-4 text-blue-500" />;
      case 'EDIT': return <Edit className="h-4 w-4 text-yellow-500" />;
      case 'MAINTENANCE': return <Wrench className="h-4 w-4 text-orange-500" />;
      case 'BORROW_REQUEST': return <CalendarDays className="h-4 w-4 text-purple-500" />;
      case 'BORROW_CHECKOUT': return <ArrowUpRight className="h-4 w-4 text-red-500" />;
      case 'BORROW_RETURN': return <ArrowDownLeft className="h-4 w-4 text-green-500" />;
      case 'BORROW_COMPLETED': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'BORROW_REJECTED': return <XCircle className="h-4 w-4 text-destructive" />;
      // Add other cases like BORROW_APPROVED if needed
      default: return <History className="h-4 w-4 text-gray-500" />;
    }
  };

  // Determine if tooltip should be shown
  const showMaintenanceTooltip = effectiveStatus === EquipmentStatus.UNDER_MAINTENANCE && latestMaintenanceNote;

  // *** NEW: Render Borrow History ***
  const renderBorrowHistory = () => {
    if (!equipment) return null; // Should be handled by main loading state
    if (!sortedBorrowRecords || sortedBorrowRecords.length === 0) {
      return <p className="text-sm text-muted-foreground italic px-6 pb-6">No borrow history found for this equipment.</p>;
    }

    return (
      <div className="max-h-[800px] overflow-y-auto pr-6 pl-6 pb-6">
        <div className="space-y-4">
          {sortedBorrowRecords.map((borrow: BorrowWithDetails) => (
            <div key={borrow.id} className="flex items-start gap-4 p-3 border rounded-md bg-background/50">
               {/* Icon based on status? Or generic history icon? */}
               {/* <History className="h-5 w-5 text-muted-foreground mt-1" /> */} 
              <div className="flex-grow space-y-1">
                <div className="flex justify-between items-center">
                   <p className="text-sm font-medium">
                       <UserIcon className="inline h-4 w-4 mr-1.5 text-muted-foreground"/> 
                       Borrowed by: <Link href={`/users/${borrow.borrower.id}/profile`} className="hover:underline">{borrow.borrower.name ?? borrow.borrower.email}</Link>
                   </p>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {/* *** Reservation Type Badge *** */}
                        <Badge 
                            variant={getReservationTypeVariant(borrow.reservationType)}
                            className="capitalize text-[10px] scale-95 whitespace-nowrap font-normal"
                        >
                            {formatReservationType(borrow.reservationType)}
                        </Badge>
                        {/* Borrow Status Badge */}
                        <Badge variant={getBorrowStatusVariant(borrow.borrowStatus)} className="capitalize text-xs whitespace-nowrap">
                            {formatBorrowStatus(borrow.borrowStatus)}
                        </Badge>
                    </div>
                </div>
                 {borrow.class && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <School className="h-3.5 w-3.5"/> Class: {borrow.class.courseCode} {borrow.class.section}
                    </p>
                 )}
                 <p className="text-xs text-muted-foreground">
                    Requested: {safeFormatDate(borrow.requestedStartTime, 'PPp')} - {safeFormatDate(borrow.requestedEndTime, 'PPp')}
                 </p>
                 {borrow.approvedStartTime && borrow.approvedEndTime && (
                   <p className="text-xs text-muted-foreground">
                      Approved: {safeFormatDate(borrow.approvedStartTime, 'PPp')} - {safeFormatDate(borrow.approvedEndTime, 'PPp')}
                   </p>
                 )}
                 {borrow.checkoutTime && (
                   <p className="text-xs text-muted-foreground">
                       Checked Out: {safeFormatDate(borrow.checkoutTime, 'PPp')}
                   </p>
                 )}
                 {borrow.actualReturnTime && (
                   <p className="text-xs text-muted-foreground">
                       Returned: {safeFormatDate(borrow.actualReturnTime, 'PPp')}
                   </p>
                 )}
                 {/* Link to group? */}
                 {/* {borrow.borrowGroupId && <Link href={`/borrows/group/${borrow.borrowGroupId}`}>Group</Link>} */} 
               </div>
             </div>
           ))}
         </div>
       </div>
     );
   };
  // *** END NEW ***

  return (
    <TooltipProvider>
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/equipment"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
          <ArrowLeft className="h-4 w-4" />
          Back to Equipment List
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1 space-y-6">
            <Card className="overflow-hidden bg-card">
              <CardContent className="p-0">
                <div className="relative aspect-square w-full">
                  <Image
                    src={equipment.images?.[0] || '/images/placeholder-default.png'}
                    alt={equipment.name}
                    fill
                    className="object-cover"
                    priority
                    onError={(e) => {
                      e.currentTarget.srcset = '/images/placeholder-default.png';
                      e.currentTarget.src = '/images/placeholder-default.png';
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {/* {equipment.status !== EquipmentStatus.OUT_OF_COMMISSION && equipment.status !== EquipmentStatus.DEFECTIVE && (
                  <ReservationModal 
                      equipmentToReserve={[equipment]}
                      triggerButton={ <Button className="w-full">Reserve Now</Button> }
                      onReservationSuccess={handleReservationSuccess}
                  />
              )} */}
              {/* Commented out the individual ReservationModal trigger above */}
              {canManage && (
                <Button variant="outline" className="w-full justify-start gap-2" asChild>
                  <Link href={`/equipment/${id}/edit`}>
                    <Edit className="h-4 w-4" /> Edit Equipment
                  </Link>
                </Button>
              )}
              {canManage && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full justify-start gap-2" disabled={isDeleting}>
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Delete Equipment
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the equipment
                        record and potentially related borrow history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                        {isDeleting ? "Deleting..." : "Yes, delete it"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" /> Availability
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4 flex justify-center">
                {isLoadingBookings && <div className="flex justify-center"><LoadingSpinner /></div>}
                {bookingError && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {bookingError}</p>}
                {!isLoadingBookings && !bookingError && (
                  <Calendar
                    mode="single"
                    modifiers={modifiers}
                    modifiersStyles={modifiersStyles}
                    className="rounded-md border"
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                  />
                )}
              </CardContent>
              <p className="text-xs text-muted-foreground px-6 pb-4 -mt-2">
                 Dates marked indicate the equipment is reserved or borrowed.
              </p>
            </Card>

          </div>

          <div className="md:col-span-2 space-y-6">
            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-2xl font-bold">{equipment.name}</CardTitle>
                <div className="flex flex-wrap gap-2 pt-2">
                  {showMaintenanceTooltip ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant={statusVariant} className="capitalize cursor-help">
                          {formatStatusText(effectiveStatus)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-sm">Latest Note: {latestMaintenanceNote}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant={statusVariant} className="capitalize">
                      {formatStatusText(effectiveStatus)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="capitalize">
                    {formatCategory(equipment.category)}
                  </Badge>
                  {equipment.equipmentId && (
                      <Badge variant="secondary">ID: {equipment.equipmentId}</Badge>
                  )}
                   <Badge variant="secondary">Stock: {equipment.stockCount}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                 {equipment.condition && (
                  <div>
                    <h4 className="font-semibold text-sm text-muted-foreground mb-1">Description</h4>
                    <p className="text-sm text-foreground/90">{equipment.condition}</p>
                  </div>
                )}
                {equipment.purchaseCost != null && (
                  <div>
                     <h4 className="font-semibold text-sm text-muted-foreground mb-1">Purchase Cost</h4>
                     <p className="text-sm text-foreground/90">₱{equipment.purchaseCost.toFixed(2)}</p>
                   </div>
                )}
                 <div>
                   <h4 className="font-semibold text-sm text-muted-foreground mb-1">Date Added</h4>
                   <p className="text-sm text-foreground/90">{safeFormatDate(equipment.createdAt, 'PPP')}</p>
                 </div>
                 <div>
                   <h4 className="font-semibold text-sm text-muted-foreground mb-1">Last Updated</h4>
                   <p className="text-sm text-foreground/90">{safeFormatDate(equipment.updatedAt, 'Pp')}</p>
                 </div>
              </CardContent>
            </Card>

             <Card className="bg-card">
               <CardHeader>
                 <CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5"/> Activity Log</CardTitle>
               </CardHeader>
               <CardContent className="max-h-[500px] overflow-y-auto pr-3">
                {sortedLogEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity history found.</p>
                ) : (
                  <ul className="space-y-4">
                    {sortedLogEntries.map((entry, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <span className="mt-1">{getLogIcon(entry.type)}</span>
                        <div className="flex-1">
                          <p className="text-sm text-foreground/90">{entry.details}</p>
                          <p className="text-xs text-muted-foreground">
                            {safeFormatDate(entry.timestamp, 'PPP p')} 
                            {entry.user && ` - ${entry.user.name || entry.user.email || 'Unknown User'}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
               </CardContent>
             </Card>
             
             <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center space-x-2">
                  <History className="h-5 w-5 text-gray-500" />
                  <span className="font-medium">Finished Borrows:</span>
                  <span>{equipment?._count?.borrowRecords ?? 0}</span>
                </CardTitle>
              </CardHeader>
            </Card>

            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center space-x-2">
                  <CalendarDays className="h-5 w-5 text-gray-500" />
                  <span className="font-medium">Net Contact Hours:</span>
                  <span>{netContactHoursFormatted}</span>
                </CardTitle>
              </CardHeader>
            </Card>

            {/* Commenting out Maintenance Count Card
            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center space-x-2">
                  <Wrench className="h-5 w-5 text-gray-500" />
                  <span className="font-medium">Maintenance Count:</span>
                  <span>{equipment.maintenanceLog?.length ?? 'N/A'}</span>
                </CardTitle>
              </CardHeader>
            </Card>
            */}

            <Card className="col-span-1 lg:col-span-1">
              <CardHeader>
                  <CardTitle className="text-lg">Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                      <span>Finished Borrows:</span>
                      <span>{equipment?._count?.borrowRecords ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                      <span>Net Contact Hours:</span>
                      <span>{netContactHoursFormatted}</span>
                  </div>
                   {/* Commenting out Maintenance Logs line item
                   <div className="flex justify-between">
                      <span>Maintenance Logs:</span>
                      <span>{equipment.maintenanceLog?.length ?? 0}</span>
                  </div>
                  */}
                  <div className="flex justify-between">
                      <span>Condition:</span>
                      <span className="capitalize">{equipment.condition?.toLowerCase() ?? 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                      <span>Purchase Cost:</span>
                      <span>{equipment.purchaseCost ? `₱${equipment.purchaseCost.toFixed(2)}` : 'N/A'}</span>
                  </div>
              </CardContent>
            </Card>

            {/* Custom Notes Card */}
            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5"/> Admin Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Display existing notes */}
                <div className="max-h-[300px] overflow-y-auto space-y-4 pr-3 mb-6">
                  {(!equipment?.customNotesLog || equipment.customNotesLog.length === 0) ? (
                    <p className="text-sm text-muted-foreground">No custom notes added yet.</p>
                  ) : (
                    [...equipment.customNotesLog].reverse().map((logItem, index) => {
                      if (typeof logItem !== 'object' || logItem === null) return null; 
                      const note = logItem as any; 
                      if (!note.timestamp || !note.userDisplay || !note.text) return null;
                      
                      const isCurrentlyDeleting = isDeletingNote === note.timestamp;

                      return (
                        <div key={index} className="text-sm border-b border-border/50 pb-3 mb-3 last:border-b-0 last:pb-0 last:mb-0 flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <p className="text-foreground/90 mb-1 break-words whitespace-pre-wrap">{note.text}</p>
                            <p className="text-xs text-muted-foreground">
                              {safeFormatDate(note.timestamp, 'Pp')} - {note.userDisplay}
                            </p>
                          </div>
                          {/* Delete Button - Show only for STAFF/FACULTY */}
                          {canManage && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:bg-destructive/10 h-8 w-8 flex-shrink-0"
                                  disabled={isCurrentlyDeleting || !!isDeletingNote} // Disable if this note or any note is being deleted
                                  aria-label="Delete note"
                                >
                                  {isCurrentlyDeleting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action cannot be undone. This will permanently delete the following note:
                                  </AlertDialogDescription>
                                  <blockquote className="mt-2 pl-4 italic border-l-2 border-border text-sm text-muted-foreground">
                                    {note.text}
                                  </blockquote>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => handleDeleteNote(note.timestamp)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete Note
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Input form for admins */}
                {canManage && (
                  <form onSubmit={handleNoteSubmit} className="space-y-3">
                    <Textarea
                      placeholder="Add a new administrative note..."
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      rows={3}
                      disabled={isSubmittingNote}
                      maxLength={500} // Optional: Add a max length
                    />
                    <Button type="submit" disabled={isSubmittingNote || !newNoteText.trim()}>
                      {isSubmittingNote && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                      Add Note
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>

            {/* *** NEW: Borrow History Card *** */}
            <Card className="bg-card/80 border-border/50 mt-6">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <History className="mr-2 h-5 w-5" /> Borrow History
                </CardTitle>
                 <CardDescription>Past and present borrows associated with this equipment.</CardDescription>
              </CardHeader>
               {/* Render history inside CardContent or directly */}
              <CardContent className="p-0">
                {renderBorrowHistory()}
              </CardContent>
            </Card>
            {/* *** END NEW *** */} 

          </div>
        </div>
      </div>
    </TooltipProvider>
  );
} 