'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, ArrowRightCircle, Loader2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Prisma, Borrow, Equipment, User as PrismaUser, BorrowStatus, UserRole, ReservationType } from '@prisma/client';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Helper function to format reservation type
const formatReservationType = (type: ReservationType | null | undefined): string => {
    if (!type) return 'N/A';
    return type === 'IN_CLASS' ? 'In Class' : type === 'OUT_OF_CLASS' ? 'Out of Class' : 'N/A';
};

// Define the shape of the data returned by the API
const borrowGroupItemSelect = Prisma.validator<Prisma.BorrowSelect>()({
    id: true,
    borrowGroupId: true,
    borrowerId: true,
    equipmentId: true,
    classId: true,
    requestedStartTime: true,
    requestedEndTime: true,
    approvedStartTime: true,
    approvedEndTime: true,
    checkoutTime: true,
    actualReturnTime: true,
    borrowStatus: true,
    requestSubmissionTime: true,
    reservationType: true,
    equipment: {
        select: { id: true, name: true, equipmentId: true, images: true }
    },
    borrower: {
        select: { id: true, name: true, email: true }
    },
    class: { 
        select: { courseCode: true, section: true, semester: true, academicYear: true }
    }
});

type BorrowGroupItem = Prisma.BorrowGetPayload<{ select: typeof borrowGroupItemSelect }>;

// Define a simple type for the user object expected for group mates
interface GroupMateUser extends Pick<PrismaUser, 'id' | 'name' | 'email'> {}

// Define the expected API response structure
interface GroupDetailsResponse {
    borrows: BorrowGroupItem[];
    groupMates: GroupMateUser[];
}

// Async function to fetch group details
const fetchGroupDetails = async (groupId: string): Promise<GroupDetailsResponse> => {
    if (!groupId) throw new Error("Group ID is required");

    const response = await fetch(`/api/borrows/group/${groupId}`);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch group details (${response.status})`);
    }
    const data = await response.json();
    if (!data || !data.borrows) {
        throw new Error("Invalid data structure received from API or group not found.");
    }
    return data as GroupDetailsResponse;
};

export default function BorrowGroupDetailPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const { data: session, status: sessionStatus } = useSession();
    const groupId = params.groupId as string;

    const [isCheckingOut, setIsCheckingOut] = useState(false);

    const { 
        data,
        isLoading,
        error,
    } = useQuery<GroupDetailsResponse, Error>({
        queryKey: ['borrowGroup', groupId],
        queryFn: () => fetchGroupDetails(groupId),
        enabled: !!groupId,
        staleTime: 1000 * 60,
    });

    const borrowItems = data?.borrows || [];
    const groupMates = data?.groupMates || [];

    const handleCheckoutGroup = async () => {
        console.log("[Checkout Group Frontend] handleCheckoutGroup entered.");
        console.log(`[Checkout Group Frontend] State before fetch: groupId=${groupId}, itemsCount=${borrowItems.length}, isCheckingOut=${isCheckingOut}, canCheckout=${canCheckout}`);

        if (!groupId || borrowItems.length === 0 || !canCheckout) {
             console.log("[Checkout Group Frontend] Aborted: Missing groupId or items.");
             return;
        }

        console.log(`[Checkout Group Frontend] Initiating checkout for group ID: ${groupId}`);
        setIsCheckingOut(true);
        try {
            const response = await fetch(`/api/borrows/bulk?groupId=${groupId}&action=checkout`, {
                method: 'PATCH',
            });
            const result = await response.json();
            console.log(`[Checkout Group Frontend] API Response Status: ${response.status}`);
            console.log(`[Checkout Group Frontend] API Response Body:`, result);
            if (!response.ok) {
                throw new Error(result.message || result.error || 'Failed to checkout group.');
            }
            toast.success(result.message || `Successfully checked out ${result.count} items.`);

            await queryClient.invalidateQueries({ queryKey: ['borrowGroup', groupId] });
            await queryClient.invalidateQueries({ queryKey: ['dashboardReservations'] }); 
            await queryClient.invalidateQueries({ queryKey: ['pendingBorrows'] });

            router.push('/');
        } catch (err: unknown) {
            console.error("Checkout error:", err);
            const message = err instanceof Error ? err.message : "An unknown error occurred during checkout.";
            toast.error(`Checkout failed: ${message}`);
        } finally {
            setIsCheckingOut(false);
        }
    };

    // Determine if the logged-in user can view equipment details
    const canViewDetails = sessionStatus === 'authenticated' && !!session?.user && session.user.role !== UserRole.REGULAR;

    // Click handler for regular users trying to click item name/image
    const handleRegularUserItemClick = (event: React.MouseEvent) => {
      // Prevent accidental triggers if something else interactive is ever added
      if ((event.target as HTMLElement).closest('button, a, input')) {
          // If it's already a link (for authorized users), let the link handle it
          if ((event.target as HTMLElement).closest('a')) return;
          // Otherwise, prevent the toast for other interactive elements
          event.stopPropagation(); 
          return;
      }
      toast.error("You do not have permission to view equipment details.");
    };

    const representativeItem = useMemo(() => borrowItems[0] || null, [borrowItems]);
    const canCheckout = useMemo(() => {
        if (!borrowItems || borrowItems.length === 0) return false;
        return borrowItems.every(item => item.borrowStatus === BorrowStatus.APPROVED);
    }, [borrowItems]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center min-h-[60vh]">
                <LoadingSpinner size="lg" /> Loading Group Details...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-10">
                <p className="text-destructive mb-4">Error: {error.message}</p>
                <Button variant="outline" asChild>
                    <Link href="/">
                        <ArrowLeft className="mr-2 h-4 w-4"/> Back to Dashboard
                    </Link>
                </Button>
            </div>
        );
    }

    if (!representativeItem) {
        return (
            <div className="text-center py-10">
                <p className="text-muted-foreground mb-4">Borrow group not found or has no borrowable items.</p>
                <Button variant="outline" asChild>
                    <Link href="/">
                        <ArrowLeft className="mr-2 h-4 w-4"/> Back to Dashboard
                    </Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-10 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" asChild>
                        <Link href="/">
                            <ArrowLeft className="h-4 w-4"/>
                            <span className="sr-only">Back to Dashboard</span>
                        </Link>
                    </Button>
                    <h1 className="text-2xl font-bold text-white truncate">
                        Borrow Group: {groupId}
                    </h1>
                </div>
                {canCheckout && (
                    <Button 
                        onClick={handleCheckoutGroup}
                        disabled={isCheckingOut}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        {isCheckingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightCircle className="mr-2 h-4 w-4" />}
                        Checkout Group ({borrowItems.length})
                    </Button>
                )}
            </div>
            <Card className="bg-card/80 border-border">
                <CardHeader>
                    <CardTitle>Group Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="font-semibold text-muted-foreground">Borrower:</span> {representativeItem.borrower.name || representativeItem.borrower.email}
                    </div>
                    <div>
                        <span className="font-semibold text-muted-foreground">Status:</span> 
                        <Badge variant={representativeItem.borrowStatus === 'APPROVED' ? 'secondary' : 'outline'} className="ml-2">
                            {representativeItem.borrowStatus} 
                        </Badge>
                    </div>
                    <div>
                        <span className="font-semibold text-muted-foreground">Requested Period:</span> 
                        {format(new Date(representativeItem.requestedStartTime), 'PPp')} - {format(new Date(representativeItem.requestedEndTime), 'PPp')}
                    </div>
                     {representativeItem.approvedStartTime && representativeItem.approvedEndTime && (
                        <div>
                            <span className="font-semibold text-muted-foreground">Approved Period:</span> 
                             {format(new Date(representativeItem.approvedStartTime), 'PPp')} - {format(new Date(representativeItem.approvedEndTime), 'PPp')}
                        </div>
                    )}
                    <div>
                        <span className="font-semibold text-muted-foreground">Purpose: </span> 
                        {formatReservationType(representativeItem?.reservationType)}
                    </div>
                    {representativeItem.class && (
                         <div>
                             <span className="font-semibold text-muted-foreground">Class:</span> {representativeItem.class.courseCode} {representativeItem.class.section} ({representativeItem.class.semester})
                         </div>
                    )}
                </CardContent>
            </Card>
            <Card className="bg-card/80 border-border">
                <CardHeader>
                    <CardTitle>Items in this Group ({borrowItems.length})</CardTitle>
                </CardHeader>
                <CardContent>
                     <div className="border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[80px]"></TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Equipment ID</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {borrowItems.map((item) => {
                                    // --- Helper to convert DB path to URL path --- 
                                    const getImagePath = (dbPath: string | undefined | null): string => {
                                        const fallback = '/images/placeholder-default.png'; // *** CORRECTED FALLBACK ***
                                        if (!dbPath || typeof dbPath !== 'string') {
                                            return fallback;
                                        }
                                        // Check if it's the problematic absolute path
                                        const publicDirMarker = '/public/';
                                        const publicIndex = dbPath.indexOf(publicDirMarker);
                                        if (publicIndex !== -1) {
                                             // Extract the part after /public (e.g., /images/...) 
                                             return dbPath.substring(publicIndex + publicDirMarker.length - 1);
                                        }
                                        // If it doesn't contain '/public/', assume it might be a correct relative path or external URL
                                        if (dbPath.startsWith('/') || dbPath.startsWith('http')) {
                                             return dbPath;
                                        }
                                         // If it's neither, return fallback
                                        console.warn(`Unrecognized image path format: ${dbPath}`);
                                        return fallback;
                                    };
                                    const imageSrc = getImagePath(item.equipment.images?.[0]);
                                    // --- End Helper ---

                                    return (
                                        <TableRow key={item.id} className="hover:bg-muted/20">
                                            {/* Image Cell: Conditionally Link or Div with onClick */}
                                            <TableCell className="p-0">
                                                {canViewDetails ? (
                                                    <Link
                                                        href={`/equipment/${item.equipment.id}`}
                                                        className="relative flex h-16 w-16 items-center justify-center bg-background rounded overflow-hidden border p-2"
                                                        aria-label={`View details for ${item.equipment.name}`}
                                                    >
                                                        <Image
                                                            src={imageSrc}
                                                            alt={item.equipment.name}
                                                            width={50}
                                                            height={50}
                                                            className="object-contain"
                                                            onError={(e) => { (e.target as HTMLImageElement).src = '/images/placeholder-default.png'; }}
                                                        />
                                                    </Link>
                                                ) : (
                                                    <div
                                                        onClick={handleRegularUserItemClick}
                                                        className="relative flex h-16 w-16 items-center justify-center bg-background rounded overflow-hidden border cursor-not-allowed p-2"
                                                        aria-label={item.equipment.name}
                                                    >
                                                        <Image
                                                            src={imageSrc}
                                                            alt={item.equipment.name}
                                                            width={50}
                                                            height={50}
                                                            className="object-contain"
                                                            onError={(e) => { (e.target as HTMLImageElement).src = '/images/placeholder-default.png'; }}
                                                        />
                                                    </div>
                                                )}
                                            </TableCell>
                                            {/* Name Cell: Conditionally Link or Div with onClick */}
                                            <TableCell>
                                                {canViewDetails ? (
                                                    <Link
                                                        href={`/equipment/${item.equipment.id}`}
                                                        className="font-medium hover:underline"
                                                        aria-label={`View details for ${item.equipment.name}`}
                                                    >
                                                        {item.equipment.name}
                                                    </Link>
                                                ) : (
                                                    <div 
                                                        onClick={handleRegularUserItemClick} 
                                                        className="font-medium cursor-not-allowed"
                                                        aria-label={item.equipment.name}
                                                    >
                                                        {item.equipment.name}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="p-2">{item.equipment.equipmentId || 'N/A'}</TableCell>
                                            <TableCell className="p-2">
                                                <Badge variant={item.borrowStatus === 'APPROVED' ? 'secondary' : item.borrowStatus === 'PENDING' ? 'outline' : 'destructive'} className="capitalize">
                                                    {item.borrowStatus.toLowerCase().replace('_', ' ')}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
            <Card className="bg-card/80 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center">
                        <Users className="mr-2 h-5 w-5"/> Group Members ({groupMates.length})
                    </CardTitle>
                    <CardDescription>
                        Users associated with this borrow group request (including borrower).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {groupMates.length > 0 ? (
                        <ul className="space-y-2 text-sm">
                            {groupMates.map((mate) => (
                                <li key={mate.id} className="flex justify-between items-center p-2 rounded hover:bg-muted/50">
                                    <Link href={`/users/${mate.id}/profile`} className="font-medium hover:underline">
                                        {mate.name}
                                    </Link>
                                    <span className="text-muted-foreground text-xs">{mate.email}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No group members found (this might indicate an issue).</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
} 