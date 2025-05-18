'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation'; // Import for redirection
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { User, Borrow, Equipment, UserRole, UserStatus, BorrowStatus, Class, ReservationType } from '@prisma/client';
import { format, isValid, formatDistanceStrict } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Users, Clock, BookUser } from 'lucide-react'; // Added BookUser, Removed Edit, KeyRound
import Image from 'next/image';
import { toast } from "sonner"; // Added toast import
import Link from 'next/link'; // Ensure Link is imported
import { useQuery } from '@tanstack/react-query'; // Import useQuery
import { transformGoogleDriveUrl } from "@/lib/utils"; // Added transformGoogleDriveUrl
// Removed cn, ProfileEditForm, ChangePasswordForm imports

// UserProfile type remains the same
type UserProfile = Omit<User, 'password'> & { sex: 'Male' | 'Female' | null };

// Borrow type remains the same
type BorrowWithEquipment = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images'>;
    expectedReturnTime: Date | null;
    borrowGroupId: string | null;
    actualReturnTime: Date | null;
    checkoutTime: Date | null; // Ensure checkoutTime is fetched
    approvedStartTime?: Date | null; // Add if needed by calculateDuration fallback
};

// NEW: Borrow type including equipment, borrower, and class details for Faculty Borrows
type BorrowWithDetails = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images' | 'id'>;
    borrower: Pick<User, 'id' | 'name' | 'email'>;
    class: Pick<Class, 'id' | 'courseCode' | 'section' | 'academicYear' | 'semester'> | null;
    expectedReturnTime?: Date | null;
    borrowGroupId?: string | null;
    actualReturnTime?: Date | null;
    checkoutTime?: Date | null;
    _count?: { deficiencies: number };
    reservationType?: ReservationType | null;
    // Add other fields from prisma.borrow if needed for display
    requestedStartTime: Date;
    requestedEndTime: Date;
    approvedStartTime?: Date | null;
    approvedEndTime?: Date | null;
};

// Grouped borrows structure remains the same
interface GroupedBorrows {
  [groupId: string]: BorrowWithEquipment[];
}
const INDIVIDUAL_BORROWS_KEY = "__individual_history__";

// Helper functions remain the same (getBorrowStatusVariant, formatDateSafe, calculateDuration)
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

const formatDateSafe = (dateInput: string | Date | null | undefined, formatString: string = 'PPP'): string => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  return isValid(date) ? format(date, formatString) : 'Invalid Date';
};

const calculateDuration = (
    primaryStart: Date | string | null | undefined,
    primaryEnd: Date | string | null | undefined,
    fallbackStart: Date | string | null | undefined
): string => {
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let isApproximate = false;

    if (primaryEnd) {
        const parsedEnd = new Date(primaryEnd);
        if (isValid(parsedEnd)) {
            endDate = parsedEnd;
        }
    }
    if (!endDate) return 'N/A (Missing Return Time)';

    if (primaryStart) {
        const parsedStart = new Date(primaryStart);
        if (isValid(parsedStart)) {
            startDate = parsedStart;
            isApproximate = false;
        }
    }
    if (!startDate && fallbackStart) {
         const parsedFallbackStart = new Date(fallbackStart);
         if (isValid(parsedFallbackStart)) {
            startDate = parsedFallbackStart;
            isApproximate = true;
         }
    }
    if (!startDate) return 'N/A (Missing Start Time)';
    if (endDate < startDate) return 'N/A (Invalid Range)';

    try {
        const durationString = formatDistanceStrict(endDate, startDate, { addSuffix: false });
        return isApproximate ? `${durationString} (Approx.)` : durationString;
    } catch (e) {
        console.error("Error calculating duration:", e);
        return "Calculation error";
    }
};

// NEW: Helpers for Reservation Type Display (copied from profile/page.tsx)
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'IN CLASS' : 'OUT OF CLASS' ;
};
const getReservationTypeVariant = (type: ReservationType | null | undefined): "success" | "destructive" | "secondary" => {
    if (!type) return 'secondary';
    return type === 'IN_CLASS' ? 'success' : 'destructive'; // Assuming OUT_OF_CLASS should be destructive, or adjust as needed
};

const formatBorrowStatus = (status: BorrowStatus): string => {
    if (!status) return "N/A";
    return status.replace(/_/g, ' ').toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Define Props with params as a Promise
interface AdminViewUserProfilePageProps {
    params: Promise<{ id: string }>; // Type params as a Promise resolving to { id: string }
}

export default function AdminViewUserProfilePage({ params }: AdminViewUserProfilePageProps) {
  // Use React.use which expects a Promise or context
  const resolvedParams = use(params);
  const targetUserId = resolvedParams.id; // Access id after resolving

  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const token = session?.accessToken;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [borrowHistory, setBorrowHistory] = useState<BorrowWithEquipment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // NEW: State for faculty-related borrows
  const isFacultyUser = useMemo(() => profile?.role === UserRole.FACULTY, [profile?.role]);

  // NEW: Fetch function for faculty borrows for a specific user
  const fetchFacultyBorrowsForUser = async (facultyId: string): Promise<BorrowWithDetails[]> => {
    if (!token) {
        console.log("[fetchFacultyBorrowsForUser] No token available.");
        return []; // Or throw error, depending on how you want to handle
    }
    // IMPORTANT: This endpoint /api/users/${facultyId}/faculty-borrows needs to be created.
    const response = await fetch(`/api/users/${facultyId}/faculty-borrows`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            console.log(`[fetchFacultyBorrowsForUser] Unauthorized (${response.status}) for user ${facultyId}`);
            return [];
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch faculty borrows for user ${facultyId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data as BorrowWithDetails[];
  };

  const {
      data: facultyBorrows,
      isLoading: isLoadingFacultyBorrows,
      error: facultyBorrowsError,
  } = useQuery<BorrowWithDetails[], Error>({
      queryKey: ['facultyBorrows', targetUserId], // Use targetUserId in key
      queryFn: () => fetchFacultyBorrowsForUser(targetUserId),
      enabled: !!token && !!targetUserId && isFacultyUser && !!profile, // Enable only if token, targetUserId, profile exist and user is faculty
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Authorization Check Effect
  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      const userRole = session?.user?.role;
      if (userRole !== UserRole.STAFF && userRole !== UserRole.FACULTY) {
        console.warn("Unauthorized access attempt to admin user profile view.");
        toast.error("Access Denied: You do not have permission to view this page.");
        router.replace('/'); // Redirect non-admins
      }
    } else if (sessionStatus === 'unauthenticated') {
      router.replace('/login'); // Redirect unauthenticated users
    }
    // No action needed while 'loading'
  }, [sessionStatus, session, router]);

  // Fetch specific user profile details
  useEffect(() => {
    // Only run if authenticated and token is available
    if (sessionStatus === 'authenticated' && token && targetUserId) {
      const fetchProfile = async () => {
        setIsLoadingProfile(true);
        setProfileError(null);
        try {
          console.log(`[Admin View] Fetching profile for user ID: ${targetUserId}`);
          const response = await fetch(`/api/users/${targetUserId}`, { // Use resolved targetUserId
             headers: { 'Authorization': `Bearer ${token}` }
          });
          console.log(`[Admin View] Profile API Response Status: ${response.status}`);

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error('Unauthorized to fetch profile.');
            if (response.status === 404) throw new Error('User not found.');
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Failed to fetch profile: ${response.statusText}`);
          }
          const data: UserProfile = await response.json();
          setProfile(data);
        } catch (err) {
          console.error("[Admin View] Error fetching profile:", err);
          setProfileError(err instanceof Error ? err.message : "An unknown error occurred");
        } finally {
          setIsLoadingProfile(false);
        }
      };
      fetchProfile();
    } else if (sessionStatus === 'unauthenticated') {
        setIsLoadingProfile(false);
        setProfileError('Authentication required.');
    }
  }, [sessionStatus, token, targetUserId]);

  // Fetch specific user borrow history
  useEffect(() => {
    // Only run if authenticated and token is available
    if (sessionStatus === 'authenticated' && token && targetUserId) {
      const fetchHistory = async () => {
        setIsLoadingHistory(true);
        setHistoryError(null);
        try {
          console.log(`[Admin View] Fetching borrow history for user ID: ${targetUserId}`);
          const response = await fetch(`/api/borrows/user/${targetUserId}`, { // Use resolved targetUserId
             headers: { 'Authorization': `Bearer ${token}` }
          });
          console.log(`[Admin View] History API Response Status: ${response.status}`);

          if (!response.ok) {
            const errorText = await response.text();
            console.error('[Admin View] History API Error Response:', errorText);
            if (response.status === 401 || response.status === 403) throw new Error('Unauthorized to fetch borrow history.');
            if (response.status === 404) throw new Error('User or history not found.'); // Maybe 404 if user exists but has no history?
            const errorData = JSON.parse(errorText || '{}');
            throw new Error(errorData.message || `Failed to fetch history: ${response.statusText}`);
          }
          const data: BorrowWithEquipment[] = await response.json();
          console.log('[Admin View] Raw history data received:', JSON.stringify(data, null, 2));
          setBorrowHistory(data);
        } catch (err) {
          console.error("[Admin View] Error fetching or processing borrow history:", err);
          setHistoryError(err instanceof Error ? err.message : "An unknown error occurred");
        } finally {
          setIsLoadingHistory(false);
        }
      };
      fetchHistory();
    } else if (sessionStatus === 'unauthenticated') {
        setIsLoadingHistory(false);
        setHistoryError('Authentication required.');
    }
  }, [sessionStatus, token, targetUserId]);

  // Group borrow history (logic remains the same, but remove filtering)
  const groupedBorrowHistory = useMemo((): GroupedBorrows => {
    return borrowHistory.reduce((acc, borrow) => {
      const key = borrow.borrowGroupId || INDIVIDUAL_BORROWS_KEY;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(borrow);
      return acc;
    }, {} as GroupedBorrows);
  }, [borrowHistory]);

  const individualHistoryItems = groupedBorrowHistory[INDIVIDUAL_BORROWS_KEY] || [];
  const groupHistoryIds = Object.keys(groupedBorrowHistory).filter(key => key !== INDIVIDUAL_BORROWS_KEY);
  groupHistoryIds.sort((a, b) => {
      const firstItemA = groupedBorrowHistory[a]?.[0];
      const firstItemB = groupedBorrowHistory[b]?.[0];
      const dateA = firstItemA?.actualReturnTime ? new Date(firstItemA.actualReturnTime).getTime() : 0;
      const dateB = firstItemB?.actualReturnTime ? new Date(firstItemB.actualReturnTime).getTime() : 0;
      return dateB - dateA;
  });
  individualHistoryItems.sort((a, b) => {
      const dateA = a.actualReturnTime ? new Date(a.actualReturnTime).getTime() : 0;
      const dateB = b.actualReturnTime ? new Date(b.actualReturnTime).getTime() : 0;
      return dateB - dateA;
  });
  // --- END Borrow History Grouping ---

  // Handle initial loading or unauthenticated state
  if (sessionStatus === 'loading') {
    return <div className="flex justify-center items-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>;
  }

  // If session is resolved, user is authenticated, but not admin (should have been redirected, but handle defensively)
  // This check might be redundant due to the useEffect redirect, but good as a fallback
  if (sessionStatus === 'authenticated' && !(session.user?.role === UserRole.STAFF || session.user?.role === UserRole.FACULTY)) {
      return <div className="text-center text-destructive py-10">Access Denied. You do not have permission to view this page.</div>;
  }

  // Function to render profile details (remains mostly the same, just display)
  const renderProfileDetails = () => {
    if (isLoadingProfile) {
        return <LoadingSpinner />;
    }
    if (profileError) {
        return <p className="text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {profileError}</p>;
    }
    if (!profile) {
        return <p className="text-muted-foreground">Could not load profile details for this user.</p>;
    }

    return (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="font-medium text-muted-foreground">Name:</div>
            <div>{profile.name}</div>
            <div className="font-medium text-muted-foreground">Email:</div>
            <div>{profile.email}</div>
            <div className="font-medium text-muted-foreground">Student Number:</div>
            <div>{profile.studentNumber || '-'}</div>
            <div className="font-medium text-muted-foreground">Contact Number:</div>
            <div>{profile.contactNumber || '-'}</div>
            <div className="font-medium text-muted-foreground">Sex:</div>
            <div>{profile.sex === null ? '-' : profile.sex}</div> {/* Simplified display */}
            <div className="font-medium text-muted-foreground">Role:</div>
            <div><Badge variant="secondary">{profile.role}</Badge></div>
            <div className="font-medium text-muted-foreground">Status:</div>
            <div><Badge variant={profile.status === UserStatus.ACTIVE ? 'success' : 'warning'}>{profile.status.replace('_', ' ')}</Badge></div>
             <div className="font-medium text-muted-foreground">Member Since:</div>
            <div>{formatDateSafe(profile.createdAt, 'PPP')}</div>
        </dl>
    );
  };

  // Function to render borrow history (remains the same)
  const renderBorrowHistory = () => {
    if (isLoadingHistory) {
        return <LoadingSpinner />;
    }
    if (historyError) {
         return <p className="text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {historyError}</p>;
    }
    if (groupHistoryIds.length === 0 && individualHistoryItems.length === 0) {
      return <p className="text-muted-foreground italic">This user has no borrow history.</p>;
    }

    return (
        <div className="space-y-6">
            {/* Render Grouped History */}
            {groupHistoryIds.map((groupId) => {
                const groupItems = groupedBorrowHistory[groupId];
                const representativeItem = groupItems[0];
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
                                 <ul className="space-y-3 mt-3">
                                    {groupItems.map(item => (
                                        <li key={item.id} className="flex items-center gap-2">
                                            <Image
                                                src={transformGoogleDriveUrl(item.equipment.images?.[0]) || '/images/placeholder-default.png'}
                                                alt={item.equipment.name}
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
                                                <span className='font-medium'>{item.equipment.name}</span>
                                                {item.equipment.equipmentId && <span className="text-xs text-muted-foreground ml-1">({item.equipment.equipmentId})</span>}
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
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    </Link>
                );
            })}
            {/* Render Individual History */}
            {individualHistoryItems.map((borrow) => {
                const imageUrl = transformGoogleDriveUrl(borrow.equipment.images?.[0]) || '/images/placeholder-default.png';
                return (
                     <Card key={borrow.id} className="overflow-hidden bg-card/60 border">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                Individual Borrow (Returned {formatDateSafe(borrow.actualReturnTime, 'PP')})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex items-center gap-3">
                             <Image
                                src={imageUrl}
                                alt={borrow.equipment.name}
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
                                <span className='font-medium text-base'>{borrow.equipment.name}</span>
                                {borrow.equipment.equipmentId && <span className="text-xs text-muted-foreground ml-1">({borrow.equipment.equipmentId})</span>}
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
                    </Card>
                );
            })}
        </div>
    );
  };

  // NEW: Render Faculty Related Borrows
  const renderFacultyRelatedBorrows = () => {
      if (!isFacultyUser) return null; // Should not be called if not faculty, but defensive check.
      if (!profile) return null; // Ensure profile is loaded

      if (isLoadingFacultyBorrows) return <LoadingSpinner>Loading Faculty Related Borrows...</LoadingSpinner>;
      if (facultyBorrowsError) return <p className="text-destructive">Error loading faculty borrows: {facultyBorrowsError.message}</p>;
      if (!facultyBorrows || facultyBorrows.length === 0) {
        return <p className="text-muted-foreground italic">No borrow records found related to the classes managed by this faculty member.</p>;
      }

      // Sort borrows by request submission time, newest first.
      const sortedBorrows = [...facultyBorrows].sort((a, b) =>
        new Date(b.requestSubmissionTime).getTime() - new Date(a.requestSubmissionTime).getTime()
      );

      return (
          <div className="max-h-[600px] overflow-y-auto pr-1 space-y-3"> {/* Adjusted height and added space-y-3 */}
              {sortedBorrows.map((borrow) => (
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
                           <div className="flex items-center gap-1.5 flex-shrink-0">
                               {borrow.reservationType && (
                                   <Badge
                                       variant={getReservationTypeVariant(borrow.reservationType)}
                                       className="text-xs whitespace-nowrap"
                                       title={`Reservation Type: ${formatReservationType(borrow.reservationType)}`}
                                   >
                                       {formatReservationType(borrow.reservationType)}
                                   </Badge>
                               )}
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
      );
  };

  // Render the main page layout
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Update title based on fetched profile */}
      <h1 className="text-3xl font-bold mb-6 text-white">
        User Profile: {profile?.name || (isLoadingProfile ? 'Loading...' : 'Unknown User')}
      </h1>

      <div className="space-y-8">
        {/* Profile Info Card - Removed buttons */}
        <Card className="bg-card/80 border-border/60">
           <CardHeader>
              <CardTitle className="text-xl">Profile Information</CardTitle>
              {/* Removed CardDescription about registered details */}
           </CardHeader>
           <CardContent>
              {renderProfileDetails()}
           </CardContent>
        </Card>

        {/* Borrow History Card */}
        <Card className="bg-card/80 border-border/60">
            <CardHeader>
                <CardTitle className="text-xl">Borrow History</CardTitle>
                <CardDescription>Past borrow records for this user.</CardDescription>
            </CardHeader>
            <CardContent>
                {renderBorrowHistory()}
            </CardContent>
        </Card>

        {/* NEW: Faculty Related Borrows Card (conditionally rendered) */}
        {isFacultyUser && profile && (
          <Card className="bg-card/80 border border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center">
                <BookUser className="mr-2 h-5 w-5" /> Faculty Related Borrows
              </CardTitle>
              <CardDescription>Borrow requests from students in classes managed by this faculty member.</CardDescription>
            </CardHeader>
            <CardContent>
               {renderFacultyRelatedBorrows()}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Removed Edit/Password Dialogs */}
    </div>
  );
} 