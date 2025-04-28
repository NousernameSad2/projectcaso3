'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { User, Borrow, Equipment, UserRole, UserStatus, BorrowStatus } from '@prisma/client'; // Import relevant types
import { format, isValid, formatDistanceStrict } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Edit, KeyRound, Users, Clock } from 'lucide-react'; // Added icons
import Image from 'next/image';
import { cn } from '@/lib/utils';
import ProfileEditForm from '@/components/profile/ProfileEditForm'; // Import the form
import ChangePasswordForm from '@/components/profile/ChangePasswordForm'; // Import the change password form

// Correct UserProfile type to use string literals for sex
type UserProfile = Omit<User, 'password'> & { sex: 'Male' | 'Female' | null };

// Borrow type including equipment details (similar to borrows page)
type BorrowWithEquipment = Borrow & {
    equipment: Pick<Equipment, 'name' | 'equipmentId' | 'images'>;
    expectedReturnTime: Date | null;
    // Make sure borrowGroupId and actualReturnTime are included if fetching from API
    borrowGroupId: string | null;
    actualReturnTime: Date | null; 
    checkoutTime: Date | null; // Ensure checkoutTime is fetched
};

// --- NEW: Grouped borrows structure ---
interface GroupedBorrows {
  [groupId: string]: BorrowWithEquipment[];
}

const INDIVIDUAL_BORROWS_KEY = "__individual_history__"; // Use a distinct key
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

export default function ProfilePage() {
  const { data: session, status: sessionStatus } = useSession();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  const [borrowHistory, setBorrowHistory] = useState<BorrowWithEquipment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // State for managing the edit profile dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false); 
  // State for managing the change password dialog
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);

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
          const data: BorrowWithEquipment[] = await response.json();
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

  const isLoading = sessionStatus === 'loading' || isLoadingProfile || isLoadingHistory;

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
  const renderProfileDetails = () => {
    if (isLoadingProfile) {
        return <LoadingSpinner />;
    }
    if (profileError) {
        return <p className="text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4"/> {profileError}</p>;
    }
    if (!profile) {
        return <p className="text-muted-foreground">Could not load profile details.</p>;
    }
    
    // Simple list display for now
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
            <div>{profile.sex === null ? '-' : profile.sex.replace('_', ' ')}</div>
            <div className="font-medium text-muted-foreground">Role:</div>
            <div><Badge variant="secondary">{profile.role}</Badge></div>
            <div className="font-medium text-muted-foreground">Status:</div>
            <div><Badge variant={profile.status === UserStatus.ACTIVE ? 'success' : 'warning'}>{profile.status.replace('_', ' ')}</Badge></div>
             <div className="font-medium text-muted-foreground">Member Since:</div>
            <div>{formatDateSafe(profile.createdAt, 'PPP')}</div>
        </dl>
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
                <Card key={groupId} className="overflow-hidden bg-card/60 border">
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
                                return (
                                <li key={item.id} className="flex items-center gap-2">
                                    <Image 
                                        src={item.equipment.images?.[0] || '/images/placeholder-default.png'}
                                        alt={item.equipment.name}
                                        width={32}
                                        height={32}
                                        className="rounded object-cover aspect-square"
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
                                );
                            })}
                        </ul>
                    </CardContent>
                    {/* No footer actions for history */}
                </Card>
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
                const imageUrl = borrow.equipment.images?.[0] || '/images/placeholder-default.png';
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
                         {/* No footer actions for history */}
                    </Card>
                );
            })}
        </div>
    );
    // --- END NEW ---
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6 text-white">My Profile</h1>
      
      <div className="space-y-8">
        {/* Profile Info Card */}
        <Card className="bg-card/80 border-border/60">
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
        <Card className="bg-card/80 border-border/60">
            <CardHeader>
                <CardTitle className="text-xl">My Borrow History</CardTitle>
                <CardDescription>Your past and current borrow records.</CardDescription>
            </CardHeader>
            <CardContent>
                {renderBorrowHistory()}
            </CardContent>
        </Card>
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