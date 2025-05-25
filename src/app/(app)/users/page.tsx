'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react'; 
import { UserRole, UserStatus } from '@prisma/client'; 
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, CheckCircle, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'; // Added Sort icons
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge"; 
import { toast } from "sonner";
import AddUserDialog from '@/components/admin/AddUserDialog'; 
import EditUserDialog from '@/components/admin/EditUserDialog';
import { Input } from "@/components/ui/input";
import { useDebounce } from '@/hooks/useDebounce';
import Link from 'next/link'; // Add Link import
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"; // AlertDialog needed for deletion

// Define the expected structure of user data fetched from API
interface DisplayUser {
    id: string;
    name: string | null;
    email: string | null;
    role: UserRole;
    status: UserStatus; 
    createdAt: string; 
    updatedAt: string;
    studentNumber?: string | null;
    contactNumber?: string | null;
    sex?: 'Male' | 'Female' | null;
}

// Define UserData type matching EditUserDialog prop expectation
interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  studentNumber?: string | null;
  contactNumber?: string | null;
  sex?: 'Male' | 'Female' | null;
}

// Helper to get badge variant based on status
const getStatusVariant = (status: UserStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case UserStatus.ACTIVE: return "success";
    case UserStatus.PENDING_APPROVAL: return "warning";
    case UserStatus.INACTIVE: return "secondary";
    default: return "default";
  }
};

type SortField = 'name' | 'email' | 'role' | 'status' | 'createdAt';
type SortOrder = 'asc' | 'desc';

export default function AdminUsersPage() {
    console.log("--- AdminUsersPage rendered ---");
    const router = useRouter();
    // Use useSession
    const { data: session, status: sessionStatus } = useSession();
    const token = session?.accessToken;
    const loggedInUser = session?.user;
    const isAuthenticated = sessionStatus === 'authenticated';
    
    const [users, setUsers] = useState<DisplayUser[]>([]);
    // Combine loading states: session loading OR data fetching loading
    const [isFetchingData, setIsFetchingData] = useState(true); 
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});
    const hasFetchedInitialData = useRef(false); // Track initial fetch

    // --- Search State --- 
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300); // Debounce search input by 300ms
    // --- Sort State --- 
    const [sortBy, setSortBy] = useState<SortField>('name');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    // -------------------

    // State for Edit Dialog
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserData | null>(null);

    // --- State for Delete Confirmation Dialog --- 
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deletingUser, setDeletingUser] = useState<{ id: string; name: string | null } | null>(null);
    // -------------------------------------------

    console.log("AdminUsersPage: Session Status:", sessionStatus, "User:", loggedInUser, "Token:", !!token);

    // Effect for Auth Check and Redirection using useSession
    useEffect(() => {
        console.log("AdminUsersPage: Auth Check Effect running. Session Status:", sessionStatus, "User:", loggedInUser);

        // If status is determined (not loading)
        if (sessionStatus !== 'loading') {
            const isAdmin = isAuthenticated && loggedInUser && (loggedInUser.role === UserRole.STAFF || loggedInUser.role === UserRole.FACULTY);
            console.log(`Checking Admin Status: isAuthenticated=${isAuthenticated}, Role=${loggedInUser?.role}, isAdmin=${isAdmin}`);

            if (!isAdmin) {
                console.warn("Redirecting: User not authenticated or not an admin.");
                router.replace('/'); 
            }
        } 
        // If sessionStatus is 'loading', do nothing yet, wait for it to resolve

    }, [sessionStatus, isAuthenticated, loggedInUser, router]); 

    // --- Data Fetching Function (using useCallback) ---
    const fetchUsers = useCallback(async (searchTerm: string, currentSortBy: SortField, currentSortOrder: SortOrder) => {
        console.log(`Fetching users: Search="${searchTerm}", SortBy=${currentSortBy}, SortOrder=${currentSortOrder}`);
        if (!(sessionStatus === 'authenticated' && token)) {
            console.log("Fetch aborted: Not authenticated or no token.");
            setIsFetchingData(false); // Ensure loading stops if auth check fails mid-fetch trigger
            return; 
        }

        setIsFetchingData(true); 
                 setError(null);
                
                 try {
            const params = new URLSearchParams();
            if (searchTerm) params.set('search', searchTerm);
            params.set('sortBy', currentSortBy);
            params.set('sortOrder', currentSortOrder);

            const apiUrl = `/api/users?${params.toString()}`;
            console.log(`Calling API: ${apiUrl}`);

            const response = await fetch(apiUrl, {
                headers: { 'Authorization': `Bearer ${token}` },
                    });

                    if (!response.ok) {
                         if (response.status === 403) throw new Error('Access Forbidden: You do not have permission.');
                         const errorData = await response.json().catch(() => ({ message: 'Failed to fetch users' }));
                         throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                    }
                    const data: DisplayUser[] = await response.json();
                    setUsers(data);
                 } catch (err) {
                    const message = err instanceof Error ? err.message : "An unknown error occurred fetching users.";
                    console.error("Error fetching users:", err);
                    setError(message);
            setUsers([]); // Clear users on error
                 } finally {
             setIsFetchingData(false); 
        } 
    }, [sessionStatus, token]); // Dependencies for the fetch function itself
    // --------------------------------------------------

    // --- Effect for Initial/Debounced Fetch ---
    useEffect(() => {
        // Fetch data when component mounts (if authenticated) or when debounced search/sort changes
        if (sessionStatus === 'authenticated' && token) {
            fetchUsers(debouncedSearchQuery, sortBy, sortOrder);
            if (!hasFetchedInitialData.current) {
                hasFetchedInitialData.current = true;
            }
        }
    }, [sessionStatus, token, debouncedSearchQuery, sortBy, sortOrder, fetchUsers]);
    // -----------------------------------------

    // --- Sort Handler ---
    const handleSort = (field: SortField) => {
        const newSortOrder = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';
        setSortBy(field);
        setSortOrder(newSortOrder);
        // The useEffect above will trigger fetchUsers
    };
    // ------------------

    // --- Action Handlers (Update to use token from session) --- 
    const handleApprove = async (userId: string) => {
        const currentToken = session?.accessToken; // Get current token
        if (!currentToken) return toast.error("Authentication token not found.");
        setIsProcessing(prev => ({ ...prev, [`approve_${userId}`]: true }));
        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: UserStatus.ACTIVE }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to approve user');
            
            // Update local state
            setUsers(prevUsers => prevUsers.map(u => u.id === userId ? { ...u, status: UserStatus.ACTIVE } : u));
            toast.success("User approved successfully!");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to approve user.");
        } finally {
            setIsProcessing(prev => ({ ...prev, [`approve_${userId}`]: false }));
        }
    };

    // --- Modified handleDelete to open dialog ---
    const openDeleteConfirmation = (userId: string, userName: string | null) => {
        if (userId === loggedInUser?.id) {
            toast.error("You cannot delete your own account.");
            return;
        }
        setDeletingUser({ id: userId, name: userName });
        setIsDeleteDialogOpen(true);
    };

    // --- Actual deletion logic (extracted) ---
    const performDeleteUser = async () => {
        if (!deletingUser) return;
        const userId = deletingUser.id;
        const userName = deletingUser.name;

        const currentToken = session?.accessToken; 
        if (!currentToken) {
            toast.error("Authentication token not found.");
            setIsDeleteDialogOpen(false); // Close dialog on auth error
            setDeletingUser(null);
            return;
        }

        // Use the existing processing state pattern if applicable
        const deleteKey = `delete_${userId}`;
        setIsProcessing(prev => ({ ...prev, [deleteKey]: true }));

        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentToken}` },
            });
            
            if (!response.ok && response.status !== 204) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || 'Failed to delete user');
            }
            
            setUsers(prevUsers => prevUsers.filter(u => u.id !== userId));
            toast.success(`User ${userName || userId} deleted successfully!`);
            setIsDeleteDialogOpen(false); // Close dialog on success
            setDeletingUser(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete user.");
            // Keep dialog open on error?
        } finally {
            setIsProcessing(prev => ({ ...prev, [deleteKey]: false }));
        }
    };
    
    // --- Modified handleEdit ---
    const handleEdit = (userToEdit: DisplayUser) => {
        console.log("Opening edit dialog for user:", userToEdit.id);
        // Select only the fields needed by the dialog
        const userData: UserData = {
            id: userToEdit.id,
            name: userToEdit.name,
            email: userToEdit.email,
            role: userToEdit.role,
            status: userToEdit.status,
            studentNumber: userToEdit.studentNumber,
            contactNumber: userToEdit.contactNumber,
            sex: userToEdit.sex,
        };
        setEditingUser(userData);
        setIsEditDialogOpen(true);
    };

    // Add the callback function for when a user is added
    const handleUserAdded = (newUser: DisplayUser) => {
        setUsers(prevUsers => [newUser, ...prevUsers]);
    };

    // Adjust the callback function to accept UserData from the dialog
    const handleUserUpdated = (updatedUserData: UserData) => {
        setUsers(prevUsers => 
            prevUsers.map(u => {
                if (u.id === updatedUserData.id) {
                    // Return the existing user object but update the fields
                    // that were changed in the dialog
                    return { 
                        ...u, // Keep existing createdAt, updatedAt etc.
                        name: updatedUserData.name,
                        email: updatedUserData.email,
                        role: updatedUserData.role,
                        status: updatedUserData.status,
                        studentNumber: updatedUserData.studentNumber,
                        contactNumber: updatedUserData.contactNumber,
                        sex: updatedUserData.sex,
                    };
                }
                return u;
            })
        );
        setEditingUser(null); // Clear editing state
    };

    // Use derived isLoading state for initial loading indicator
    // Show loading if session is loading OR if data is fetching
    const isLoading = sessionStatus === 'loading' || isFetchingData;
    
    if (isLoading && !hasFetchedInitialData.current) { // Show full page spinner only on initial load
        return (
            <div className="flex justify-center items-center min-h-[60vh]">
                <LoadingSpinner size="lg" />
            </div>
        );
    }
    
    // If session is resolved, user is authenticated, but not admin (should have been redirected, but handle defensively)
    if (isAuthenticated && !(loggedInUser?.role === UserRole.STAFF || loggedInUser?.role === UserRole.FACULTY)) {
        return <div className="text-center text-destructive py-10">Access Denied. You do not have permission to view this page.</div>;
    }
    
     // If session is resolved but user is not authenticated (should have been redirected)
    if (sessionStatus === 'unauthenticated') {
         return <div className="text-center text-destructive py-10">Authentication Required. Please log in.</div>;
    }

    if (error) {
        return <div className="text-center text-destructive py-10">Error: {error}</div>;
    }

    // --- Helper for Sortable Header ---
    const renderSortableHeader = (field: SortField, label: string) => (
        <Button
            variant="ghost"
            onClick={() => handleSort(field)}
            className="px-2 py-1 -ml-2 text-left hover:bg-muted/30"
        >
            {label}
            {sortBy === field ? (
                sortOrder === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
                <ArrowUpDown className="ml-2 h-4 w-4 opacity-30" />
            )}
        </Button>
    );
    // -----------------------------------

    // --- Render Page --- 
    return (
        <div className="container mx-auto py-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div>
                  <h1 style={{ color: 'hsl(var(--foreground))' }} className="text-3xl font-bold">Manage Users</h1>
                  <p className="text-muted-foreground mt-1">
                    View, add, edit, and manage user accounts and permissions.
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                     {/* --- Search Input --- */} 
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search name or email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 w-full bg-background/50 focus:bg-background/80 border-border/50 focus:border-border"
                        />
                    </div>
                    {/* -------------------- */} 
                    {/* Add User Button - For STAFF or FACULTY */} 
                    {(loggedInUser?.role === UserRole.STAFF || loggedInUser?.role === UserRole.FACULTY) && (
                <AddUserDialog onUserAdded={handleUserAdded} />
                    )}
                </div>
            </div>
            {/* Optional: Show loading indicator during search fetch */}
            {isLoading && hasFetchedInitialData.current && (
                 <div className="text-center py-4 text-muted-foreground">
                    <LoadingSpinner size="sm" className="inline-block mr-2" /> Loading users...
                 </div>
             )}
            <div className="border rounded-md overflow-hidden bg-card">
                <Table>
                    <TableHeader>
                        <TableRow><TableHead>{renderSortableHeader('name', 'Name')}</TableHead><TableHead>{renderSortableHeader('email', 'Email')}</TableHead><TableHead>{renderSortableHeader('role', 'Role')}</TableHead><TableHead>{renderSortableHeader('status', 'Status')}</TableHead><TableHead>{renderSortableHeader('createdAt', 'Date Added')}</TableHead><TableHead className="text-right text-white">Actions</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                        {!isLoading && users.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    {searchQuery ? `No users found matching "${searchQuery}".` : "No users found."} 
                                </TableCell>
                            </TableRow>
                        ) : (
                            users.map((user) => {
                                const isProcessingAction = 
                                    isProcessing[`approve_${user.id}`] || isProcessing[`delete_${user.id}`];
                                const isCurrentUser = loggedInUser?.id === user.id;
                                
                                return (
                                    <TableRow key={user.id} className={isCurrentUser ? 'bg-muted/20' : ''}>
                                        <TableCell className="font-medium">
                                            {/* Make name clickable - removed text-white */}
                                            <Link
                                                href={`/users/${user.id}/profile`}
                                                className="hover:underline"
                                                >
                                                {user.name || '-'}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell>
                                             <Badge variant="outline" className="capitalize">{user.role.toLowerCase()}</Badge>
                                        </TableCell>
                                        <TableCell>
                                             <Badge variant={getStatusVariant(user.status)} className="capitalize">{user.status.replace('_', ' ').toLowerCase()}</Badge>
                                        </TableCell>
                                        {/* Display Formatted Date */}
                                        <TableCell className="text-sm text-muted-foreground">
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                             {/* Approve Button */} 
                                            {user.status === UserStatus.PENDING_APPROVAL && (
                                                <Button 
                                                   variant="outline"
                                                   size="sm"
                                                     className="mr-2 text-green-500 border-green-500/50 hover:bg-green-500/10 hover:text-green-600"
                                                   onClick={() => handleApprove(user.id)} 
                                                     disabled={isProcessingAction}
                                                >
                                                     <CheckCircle className="mr-1 h-4 w-4" /> Approve
                                                </Button>
                                            )}
                                             {/* Edit Button */} 
                                            <Button 
                                                 variant="ghost" 
                                                size="sm"
                                                 className="mr-2 hover:bg-muted/50"
                                                onClick={() => handleEdit(user)}
                                                 disabled={isProcessingAction}
                                                title="Edit User"
                                            >
                                                 <Edit className="h-4 w-4" />
                                            </Button>
                                             {/* Delete Button - Disable for current user */} 
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:bg-destructive/10"
                                                onClick={() => openDeleteConfirmation(user.id, user.name)}
                                                disabled={isProcessing[`delete_${user.id}`] || user.id === loggedInUser?.id}
                                                title={user.id === loggedInUser?.id ? "Cannot delete self" : "Delete User"}
                                            >
                                                {isProcessing[`delete_${user.id}`] ? <LoadingSpinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
            {/* Edit User Dialog - Render conditionally */}
            {editingUser && (
                <EditUserDialog
                    isOpen={isEditDialogOpen}
                    onOpenChange={setIsEditDialogOpen}
                    user={editingUser}
                    onUserUpdated={handleUserUpdated}
                />
            )}
            {/* --- Deletion Confirmation Dialog --- */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action will permanently delete the user 
                            <strong>{deletingUser?.name || deletingUser?.id}</strong>. 
                            This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing[`delete_${deletingUser?.id}`]}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={performDeleteUser}
                            disabled={isProcessing[`delete_${deletingUser?.id}`]} // Use existing processing state
                            className="bg-destructive hover:bg-destructive/90"
                        >
                            {isProcessing[`delete_${deletingUser?.id}`] ? <LoadingSpinner size="sm" className="mr-2" /> : null}
                            Confirm Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {/* --- End Deletion Dialog --- */}
        </div>
    );
} 