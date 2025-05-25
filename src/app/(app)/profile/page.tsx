'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { User, Borrow, Equipment, UserRole, UserStatus, BorrowStatus, Class, ReservationType } from '@prisma/client'; // Import relevant types
import { format, isValid, formatDistanceStrict } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Edit, KeyRound, Users, Clock, BookUser } from 'lucide-react'; // Added BookUser
import Image from 'next/image';
import { transformGoogleDriveUrl } from '@/lib/utils';
import ProfileEditForm from '@/components/profile/ProfileEditForm'; // Import the form
import ChangePasswordForm from '@/components/profile/ChangePasswordForm'; // Import the change password form
import Link from 'next/link'; // Add Link import
import { useQuery } from '@tanstack/react-query'; // Import useQuery

// Correct UserProfile type to use string literals for sex
type UserProfile = Omit<User, 'password'> & { sex: 'Male' | 'Female' | null };

// Borrow type including equipment details (similar to borrows page)
type BorrowWithDetails = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images' | 'id'>;
    borrower: Pick<User, 'id' | 'name' | 'email'>; // <<< Added borrower
    class: Pick<Class, 'id' | 'courseCode' | 'section' | 'academicYear' | 'semester'> | null; // <<< Added class
    expectedReturnTime?: Date | null;
    borrowGroupId?: string | null;
    actualReturnTime?: Date | null; 
    checkoutTime?: Date | null;
    _count?: { deficiencies: number }; // <<< Added deficiency count
    reservationType?: ReservationType | null; 
};

// --- Grouped borrows structure (for personal history) ---
interface GroupedBorrows {
  [groupId: string]: BorrowWithDetails[];
}
const INDIVIDUAL_BORROWS_KEY = "__individual_history__"; 
// --- END NEW ---

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
    return type === 'IN_CLASS' ? 'IN CLASS' : 'OUT OF CLASS';
};
const getReservationTypeVariant = (type: ReservationType | null | undefined): "success" | "destructive" | "secondary" => {
    if (!type) return 'secondary';
    return type === 'IN_CLASS' ? 'success' : 'destructive';
};

// Helper function to safely format dates (copied from my-borrows)
const formatDateSafe = (dateInput: string | Date | null | undefined, formatString: string = 'PPP'): string => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  // Optional: Add logging like in my-borrows if needed
  return isValid(date) ? format(date, formatString) : 'Invalid Date';
};

// --- NEW: Utility function to calculate duration (copied from my-borrows) ---
// Modified to include fallback logic
const calculateDuration = (
    primaryStart: Date | string | null | undefined, 
    primaryEnd: Date | string | null | undefined, 
    fallbackStart: Date | string | null | undefined // Use approvedStartTime as fallback
): string => {
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let isApproximate = false;

    // Determine end date (must be present for any duration calc)
    if (primaryEnd) {
        const parsedEnd = new Date(primaryEnd);
        if (isValid(parsedEnd)) {
            endDate = parsedEnd;
        }
    }
    if (!endDate) return 'N/A (Missing Return Time)'; // Can't calculate duration without end time

    // Determine start date (try primary first, then fallback)
    if (primaryStart) {
        const parsedStart = new Date(primaryStart);
        if (isValid(parsedStart)) {
            startDate = parsedStart;
            isApproximate = false;
        }
    }
    // If primary start failed or was null, try fallback
    if (!startDate && fallbackStart) {
         const parsedFallbackStart = new Date(fallbackStart);
         if (isValid(parsedFallbackStart)) {
            startDate = parsedFallbackStart;
            isApproximate = true; // Mark as approximate if fallback was used
         }
    }

    // If no valid start date found, return N/A
    if (!startDate) return 'N/A (Missing Start Time)';

    // Ensure end date is after start date
    if (endDate < startDate) {
        return 'N/A (Invalid Range)';
    }
    
    try {
        const durationString = formatDistanceStrict(endDate, startDate, { addSuffix: false });
        return isApproximate ? `${durationString} (Approx.)` : durationString; // Add approx indicator
    } catch (e) {
        console.error("Error calculating duration:", e);
        return "Calculation error";
    }
};
// --- END NEW ---

// --- NEW: Fetch function for faculty borrows ---
const fetchFacultyBorrows = async (): Promise<BorrowWithDetails[]> => {
    const response = await fetch('/api/users/me/faculty-borrows');
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            // Don't throw for auth errors, handle in component
            console.log(`[fetchFacultyBorrows] Unauthorized (${response.status})`);
            return []; 
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch faculty borrows: ${response.statusText}`);
    }
    const data = await response.json();
    // Add basic validation if needed
    return data as BorrowWithDetails[];
};
// --- END NEW ---

export default function ProfilePage() {
  const { data: session, status: sessionStatus } = useSession();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  const [borrowHistory, setBorrowHistory] = useState<BorrowWithDetails[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // State for managing the edit profile dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false); 
  // State for managing the change password dialog
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);

  // *** NEW: Fetching Faculty-Related Borrows ***
  const isFaculty = useMemo(() => session?.user?.role === UserRole.FACULTY, [session?.user?.role]);

  const { 
      data: facultyBorrows,
      isLoading: isLoadingFacultyBorrows,
      error: facultyBorrowsError,
  } = useQuery<BorrowWithDetails[], Error>({
      queryKey: ['facultyBorrows', session?.user?.id], // Include userId in key
      queryFn: fetchFacultyBorrows,
      enabled: sessionStatus === 'authenticated' && isFaculty, // Only enable if authenticated and faculty
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
  // *** END NEW ***

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isLoading = sessionStatus === 'loading' || isLoadingProfile || isLoadingHistory || (isFaculty && isLoadingFacultyBorrows);

  // Fetch user profile details
  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      const fetchProfile = async () => {
        setIsLoadingProfile(true);
        setProfileError(null);
        try {
          const response = await fetch('/api/users/me');
          if (!response.ok) {
            if (response.status === 401) throw new Error('Unauthorized to fetch profile.');
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Failed to fetch profile: ${response.statusText}`);
          }
          const data: UserProfile = await response.json();
          setProfile(data);
        } catch (err) {
          console.error("Error fetching profile:", err);
          setProfileError(err instanceof Error ? err.message : "An unknown error occurred");
        } finally {
          setIsLoadingProfile(false);
        }
      };
      fetchProfile();
    }
    // Set loading false if unauthenticated
    if (sessionStatus === 'unauthenticated') {
        setIsLoadingProfile(false);
        setProfileError('Please log in.');
    }
  }, [sessionStatus]);

  // Fetch borrow history
  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      const fetchHistory = async () => {
        setIsLoadingHistory(true);
        setHistoryError(null);
        try {
          console.log('[Profile History] Fetching /api/borrows/my-borrows...');
          const response = await fetch('/api/borrows/my-borrows');
          console.log('[Profile History] API Response Status:', response.status);
          if (!response.ok) {
            const errorText = await response.text();
            console.error('[Profile History] API Error Response:', errorText);
            if (response.status === 401) throw new Error('Unauthorized to fetch borrow history.');
            const errorData = JSON.parse(errorText || '{}');
            throw new Error(errorData.message || `Failed to fetch history: ${response.statusText}`);
          }
          const data: BorrowWithDetails[] = await response.json();
          // ---- START Logging ----
          console.log('[Profile History] Raw data received from API:', JSON.stringify(data, null, 2)); 
          // ---- END Logging ----
          setBorrowHistory(data);
        } catch (err) {
          console.error("[Profile History] Error fetching or processing borrow history:", err);
          setHistoryError(err instanceof Error ? err.message : "An unknown error occurred");
        } finally {
          setIsLoadingHistory(false);
        }
      };
      fetchHistory();
    } 
     // Set loading false if unauthenticated
    if (sessionStatus === 'unauthenticated') {
        setIsLoadingHistory(false);
        setHistoryError('Please log in.');
    }
  }, [sessionStatus]);

  // --- NEW: Group borrow history using useMemo ---
  const groupedBorrowHistory = useMemo((): GroupedBorrows => {
    return borrowHistory.reduce((acc, borrow) => {
      // Only include items that are actually completed/returned
      if (borrow.borrowStatus !== BorrowStatus.RETURNED && borrow.borrowStatus !== BorrowStatus.COMPLETED) {
        return acc; // Skip non-returned items
      }
      const key = borrow.borrowGroupId || INDIVIDUAL_BORROWS_KEY;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(borrow);
      return acc;
    }, {} as GroupedBorrows);
  }, [borrowHistory]);

  // Separate individual history items for distinct rendering
  const individualHistoryItems = groupedBorrowHistory[INDIVIDUAL_BORROWS_KEY] || [];
  const groupHistoryIds = Object.keys(groupedBorrowHistory).filter(key => key !== INDIVIDUAL_BORROWS_KEY);
  // Sort groups by return date (most recent first)
  groupHistoryIds.sort((a, b) => {
      const firstItemA = groupedBorrowHistory[a]?.[0];
      const firstItemB = groupedBorrowHistory[b]?.[0];
      const dateA = firstItemA?.actualReturnTime ? new Date(firstItemA.actualReturnTime).getTime() : 0;
      const dateB = firstItemB?.actualReturnTime ? new Date(firstItemB.actualReturnTime).getTime() : 0;
      return dateB - dateA; // Descending order
  });
  // Sort individual items by return date
  individualHistoryItems.sort((a, b) => {
      const dateA = a.actualReturnTime ? new Date(a.actualReturnTime).getTime() : 0;
      const dateB = b.actualReturnTime ? new Date(b.actualReturnTime).getTime() : 0;
      return dateB - dateA; // Descending order
  });
  // --- END NEW ---

  // Callback function for successful profile update
  const handleUpdateSuccess = (updatedData: Partial<UserProfile>) => {
      // Merge updated data with existing profile state
      setProfile(prevProfile => {
          if (!prevProfile) return null; // Should not happen if update was possible
          // Ensure we handle null/undefined correctly from partial update
          const newProfile: UserProfile = {
              ...prevProfile,
              name: updatedData.name ?? prevProfile.name,
              studentNumber: updatedData.studentNumber === null ? null : updatedData.studentNumber ?? prevProfile.studentNumber,
              contactNumber: updatedData.contactNumber === null ? null : updatedData.contactNumber ?? prevProfile.contactNumber,
              sex: updatedData.sex === null ? null : updatedData.sex ?? prevProfile.sex,
              // Keep other fields from prevProfile
          };
          return newProfile;
      });
      setIsEditDialogOpen(false); // Close dialog on success
  };

  if (sessionStatus === 'unauthenticated') {
    return <p className="text-center text-destructive py-10">Please log in to view your profile.</p>;
  }

  // Function to render profile details
  const renderProfileDetails = (): React.ReactNode => {
    if (isLoadingProfile) {
        return <LoadingSpinner />;
    }
    if (profileError) {
        return <p className="text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {profileError}</p>;
    }
    if (!profile) {
        return <p className="text-muted-foreground">Could not load profile details.</p>;
    }
    
    const detailItem = (label: string, value: React.ReactNode) => (
        <div className="mb-2">
            <span className="font-semibold text-muted-foreground text-sm">{label}:</span> 
            <span className="ml-2 text-foreground/90 text-sm">{value || 'N/A'}</span>
        </div>
    );

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {detailItem('Name', profile.name)}
            {detailItem('Email', profile.email)}
            {detailItem('ID Number', profile.studentNumber)}
            {detailItem('Contact Number', profile.contactNumber)}
            {detailItem('Sex', profile.sex)}
            {detailItem('Role', <Badge variant="outline" className="capitalize">{profile.role.toLowerCase()}</Badge>)}
            {detailItem('Status', 
               <Badge 
                   variant={profile.status === UserStatus.ACTIVE ? 'success' : 'destructive'} 
                   className="capitalize"
               >
                   {profile.status.toLowerCase()}
               </Badge>
            )}
            {detailItem('Joined', formatDateSafe(profile.createdAt))}
        </div>
    );
  };

  // Function to render borrow history
  const renderBorrowHistory = () => {
    if (isLoadingHistory) {
        return <LoadingSpinner />;
    }
    if (historyError) {
         return <p className="text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {historyError}</p>;
    }
    // Check grouped history instead
    if (groupHistoryIds.length === 0 && individualHistoryItems.length === 0) {
      return <p className="text-muted-foreground italic">You have no borrow history yet.</p>;
    }

    // ---- START Logging ----
    console.log('[Profile History Render] Grouped History Data:', JSON.stringify(groupedBorrowHistory, null, 2));
    console.log('[Profile History Render] Individual History Items:', JSON.stringify(individualHistoryItems, null, 2));
    // ---- END Logging ----

    // --- NEW: Render using grouped cards --- 
    return (
        <div className="space-y-6">
            {/* Render Grouped History */}
            {groupHistoryIds.map((groupId) => {
                const groupItems = groupedBorrowHistory[groupId];
                const representativeItem = groupItems[0]; 

                // ---- START Logging ----
                console.log(`[Profile History Render Group ${groupId}] Representative Item:`, JSON.stringify(representativeItem, null, 2));
                // ---- END Logging ----

                return (
                    <Link
                        href={`/borrows/group/${groupId}`}
                        key={groupId}
                        className="block hover:bg-muted/10 transition-colors rounded-lg"
                        >
                        <Card className="overflow-hidden bg-card/60 border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Users className="h-5 w-5"/> Group Borrow (Returned {formatDateSafe(representativeItem.actualReturnTime, 'PP')})
                                </CardTitle>
                                 <CardDescription className="text-xs mt-1">
                                   Borrow ID: {groupId}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <h4 className="text-sm font-medium mb-2 text-muted-foreground">Items ({groupItems.length}):</h4>
                                <ul className="space-y-2 text-sm">
                                    {groupItems.map(item => {
                                        // ---- START Logging ----
                                        console.log(`[Profile History Render Group Item ${item.id}] Data passed to calculation:`, JSON.stringify({ 
                                          checkoutTime: item.checkoutTime, 
                                          actualReturnTime: item.actualReturnTime, 
                                          approvedStartTime: item.approvedStartTime 
                                        }, null, 2));
                                        // ---- END Logging ----
                                        const equipmentName = item.equipment ? item.equipment.name : 'Equipment N/A';
                                        const equipmentId = item.equipment ? item.equipment.equipmentId : null;
                                        const imageUrl = item.equipment ? transformGoogleDriveUrl(item.equipment.images?.[0]) : null;

                                        return (
                                        <li key={item.id} className="flex items-center gap-2">
                                            <Image 
                                                src={imageUrl || '/images/placeholder-default.png'}
                                                alt={equipmentName || 'Equipment image'}
                                                width={32}
                                                height={32}
                                                className="rounded object-cover aspect-square"
                                                onError={(e) => {
                                                  if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                                    e.currentTarget.srcset = '/images/placeholder-default.png';
                                                    e.currentTarget.src = '/images/placeholder-default.png';
                                                  }
                                                }}
                                            />
                                            <div className='flex-grow'>
                                                <span className='font-medium'>{equipmentName}</span>
                                                {equipmentId && <span className="text-xs text-muted-foreground ml-1">({equipmentId})</span>}
                                                <span className="block text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                                    <Clock className='h-3 w-3'/> 
                                                    Duration: {calculateDuration(item.checkoutTime, item.actualReturnTime, item.approvedStartTime)}
                                                    (Returned: {formatDateSafe(item.actualReturnTime, 'Pp')})
                                                </span>
                                            </div>
                                            <Badge variant={getBorrowStatusVariant(item.borrowStatus)} className="ml-2 capitalize text-xs scale-90 whitespace-nowrap">
                                                {item.borrowStatus.toLowerCase().replace('_', ' ')}
                                            </Badge>
                                        </li>
                                        );
                                    })}
                                </ul>
                            </CardContent>
                            {/* No footer actions for history */}
                        </Card>
                    </Link>
                );
            })}
            {/* Render Individual History */}
            {individualHistoryItems.map((borrow) => {
                // ---- START Logging ----
                 console.log(`[Profile History Render Individual Item ${borrow.id}] Data passed to calculation:`, JSON.stringify({ 
                  checkoutTime: borrow.checkoutTime, 
                  actualReturnTime: borrow.actualReturnTime, 
                  approvedStartTime: borrow.approvedStartTime 
                }, null, 2));
                // ---- END Logging ----
                const equipmentName = borrow.equipment ? borrow.equipment.name : 'Equipment N/A';
                const equipmentId = borrow.equipment ? borrow.equipment.equipmentId : null;
                const imageUrl = borrow.equipment ? transformGoogleDriveUrl(borrow.equipment.images?.[0]) : null;

                return (
                     <Card key={borrow.id} className="overflow-hidden bg-card/60 border">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                Individual Borrow (Returned {formatDateSafe(borrow.actualReturnTime, 'PP')})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex items-center gap-3">
                             <Image 
                                src={imageUrl || '/images/placeholder-default.png'}
                                alt={equipmentName || 'Equipment image'}
                                width={40}
                                height={40}
                                className="rounded object-cover aspect-square"
                                onError={(e) => {
                                  if (e.currentTarget.src !== '/images/placeholder-default.png') {
                                    e.currentTarget.srcset = '/images/placeholder-default.png';
                                    e.currentTarget.src = '/images/placeholder-default.png';
                                  }
                                }}
                            />
                            <div className='flex-grow'>
                                <span className='font-medium text-base'>{equipmentName}</span>
                                {equipmentId && <span className="text-xs text-muted-foreground ml-1">({equipmentId})</span>}
                                <span className="block text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                    <Clock className='h-3 w-3'/> 
                                    Duration: {calculateDuration(borrow.checkoutTime, borrow.actualReturnTime, borrow.approvedStartTime)}
                                    (Returned: {formatDateSafe(borrow.actualReturnTime, 'Pp')})
                                </span>
                            </div>
                             <Badge variant={getBorrowStatusVariant(borrow.borrowStatus)} className="ml-2 capitalize text-xs scale-90 whitespace-nowrap">
                                {borrow.borrowStatus.toLowerCase().replace('_', ' ')}
                            </Badge>
                        </CardContent>
                         {/* No footer actions for history */}
                    </Card>
                );
            })}
        </div>
    );
    // --- END NEW ---
  };

  // *** NEW: Render Faculty Related Borrows ***
  const renderFacultyRelatedBorrows = () => {
      if (!isFaculty) return null; // Only render for faculty
      if (isLoadingFacultyBorrows) return <LoadingSpinner>Loading Faculty Related Borrows...</LoadingSpinner>;
      if (facultyBorrowsError) return <p className="text-destructive">Error loading faculty borrows: {facultyBorrowsError.message}</p>;
      if (!facultyBorrows || facultyBorrows.length === 0) return <p className="text-muted-foreground italic">No borrow records found for the classes you manage.</p>;
      
      // *** CHANGE Scrollable Container Height ***
      return (
          <div className="max-h-[800px] overflow-y-auto pr-1"> {/* Changed 400px to 800px */}
              {/* Existing space-y container */}
              <div className="space-y-3">
                {facultyBorrows.map((borrow) => (
                  <Card key={borrow.id} className="overflow-hidden bg-card/70 border">
                    <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
                      <Link
                          href={`/equipment/${borrow.equipment.id}`}
                          className="block flex-shrink-0"
                          >
                        <Image 
                          src={transformGoogleDriveUrl(borrow.equipment.images?.[0]) || '/images/placeholder-default.png'}
                          alt={borrow.equipment.name}
                          width={80} 
                          height={80} 
                          className="rounded border aspect-square object-contain bg-background p-1"
                          onError={(e) => {
                            if (e.currentTarget.src !== '/images/placeholder-default.png') {
                              e.currentTarget.srcset = '/images/placeholder-default.png';
                              e.currentTarget.src = '/images/placeholder-default.png';
                            }
                          }}
                        />
                      </Link>
                      <div className="flex-grow space-y-1 text-sm">
                         <div className="flex justify-between items-start gap-1">
                             <Link
                                 href={`/equipment/${borrow.equipment.id}`}
                                 className="font-semibold hover:underline flex-shrink min-w-0 mr-2"
                                 title={borrow.equipment.name}
                                 >
                                 <span className="truncate">{borrow.equipment.name}</span>
                             </Link>
                             {/* --- Badge Container --- */}
                             <div className="flex items-center gap-1.5 flex-shrink-0">
                                 {/* Reservation Type Badge */}
                                 <Badge
                                     variant={getReservationTypeVariant(borrow.reservationType)}
                                     className="text-xs whitespace-nowrap"
                                     title={`Reservation Type: ${formatReservationType(borrow.reservationType)}`}
                                 >
                                     {formatReservationType(borrow.reservationType)}
                                 </Badge>
                                 {/* Status Badge */}
                                 <Badge variant={getBorrowStatusVariant(borrow.borrowStatus)} className="capitalize text-xs whitespace-nowrap">
                                     {formatBorrowStatus(borrow.borrowStatus)}
                                 </Badge>
                             </div>
                         </div>
                         <p className="text-xs text-muted-foreground">
                             Borrowed by: <Link
                             href={`/users/${borrow.borrower.id}/profile`}
                             className="hover:underline"
                             >{borrow.borrower.name ?? borrow.borrower.email}</Link>
                         </p>
                         {borrow.class && (
                           <p className="text-xs text-muted-foreground">
                             Class: {borrow.class.courseCode} {borrow.class.section}
                           </p>
                         )}
                         <p className="text-xs text-muted-foreground">
                            Requested: {formatDateSafe(borrow.requestedStartTime, 'PPp')} - {formatDateSafe(borrow.requestedEndTime, 'PPp')}
                         </p>
                         {borrow.approvedStartTime && borrow.approvedEndTime && (
                             <p className="text-xs text-muted-foreground">
                               Approved: {formatDateSafe(borrow.approvedStartTime, 'PPp')} - {formatDateSafe(borrow.approvedEndTime, 'PPp')}
                             </p>
                         )}
                         {borrow.checkoutTime && (
                           <p className="text-xs text-muted-foreground">
                               Checked Out: {formatDateSafe(borrow.checkoutTime, 'PPp')}
                           </p>
                         )}
                          {/* Add link to group details if applicable? */}
                          {borrow.borrowGroupId && (
                               <Link href={`/borrows/group/${borrow.borrowGroupId}`} className="text-xs text-blue-400 hover:underline block mt-1">
                                   View Borrow Details
                               </Link>
                          )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
          </div>
      );
  };
  // *** END NEW ***

  return (
    <div className="container mx-auto max-w-4xl py-10 space-y-8">
      <div className="mb-6">
        <h1 style={{ color: 'hsl(var(--foreground))' }} className="text-3xl font-bold mb-6">My Profile</h1>
        <p className="text-muted-foreground mt-1">
          View and manage your personal information and borrow history.
        </p>
      </div>
      
      <div className="space-y-8">
        {/* Profile Info Card */}
        <Card className="overflow-hidden bg-card/80 border border-border/50">
           <CardHeader className="flex flex-row items-center justify-between">
    <div>
                    <CardTitle className="text-xl">Profile Information</CardTitle>
                    <CardDescription>Your registered details.</CardDescription>
               </div>
               <div className="flex gap-2">
                    {/* Edit Profile Button - opens the edit dialog */}
                    <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)} disabled={!profile || isLoadingProfile}>
                        <Edit className="mr-2 h-4 w-4" /> Edit Profile
                    </Button>
                    {/* Change Password Button - opens the change password dialog */}
                     <Button variant="outline" size="sm" onClick={() => setIsPasswordDialogOpen(true)}>
                        <KeyRound className="mr-2 h-4 w-4" /> Change Password
                    </Button>
               </div>
           </CardHeader>
           <CardContent>
              {renderProfileDetails()}
           </CardContent>
        </Card>

        {/* Borrow History Card */}
        <Card className="bg-card/80 border border-border/50">
            <CardHeader>
                <CardTitle className="flex items-center">
                    <Clock className="mr-2 h-5 w-5" /> Borrow History (Completed)
                </CardTitle>
                <CardDescription>Your past completed borrow records.</CardDescription>
            </CardHeader>
            <CardContent>
                {renderBorrowHistory()}
            </CardContent>
        </Card>

        {/* *** NEW: Faculty Related Borrows Card *** */}
        {isFaculty && (
          <Card className="bg-card/80 border border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center">
                <BookUser className="mr-2 h-5 w-5" /> Faculty Related Borrows
              </CardTitle>
              <CardDescription>Borrow requests from students in classes you manage.</CardDescription>
            </CardHeader>
            <CardContent>
               {renderFacultyRelatedBorrows()} 
            </CardContent>
          </Card>
        )}
        {/* *** END NEW *** */}
      </div>

      {/* Profile Edit Form Dialog */}
      {profile && (
         <ProfileEditForm
            userProfile={{
              name: profile.name,
              studentNumber: profile.studentNumber,
              contactNumber: profile.contactNumber,
              sex: profile.sex,
            }}
            isOpen={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            onUpdateSuccess={handleUpdateSuccess}
         />
      )}

      {/* Change Password Form Dialog */}
      <ChangePasswordForm 
        isOpen={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
    </div>
  );
} 