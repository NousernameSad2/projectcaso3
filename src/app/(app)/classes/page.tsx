'use client';

import React, { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from 'sonner';
import AddClassDialog from '@/components/classes/AddClassDialog';
import Link from 'next/link';
import { Trash2, Edit } from 'lucide-react';
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
} from "@/components/ui/alert-dialog"
import { UserRole } from '@prisma/client';
import { EditClassDialog } from '@/components/classes/EditClassDialog';

// Define expected Class data structure from API
interface ClassData {
  id: string;
  courseCode: string;
  section: string;
  semester: 'FIRST' | 'SECOND' | 'SUMMER' | string;
  academicYear: string;
  isActive: boolean;
  fic: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  _count: {
    enrollments: number;
    borrowRequests: number;
  };
  createdAt: string; // Or Date
  updatedAt: string; // Or Date
}

// Define type for data passed to EditClassDialog
// Ensure this matches the prop type expected by EditClassDialog
interface EditDialogClassData {
  id: string;
  courseCode: string;
  section: string;
  semester: 'FIRST' | 'SECOND' | 'SUMMER'; 
  academicYear: string;
  isActive: boolean;
  ficId: string | null; // Dialog expects ficId
  fic?: { // Keep fic details if available, dialog might use them
    id: string;
    name: string | null;
  } | null;
}

export default function ClassesPage() {
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.accessToken;
  const user = session?.user;
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // State for Edit Dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingClassData, setEditingClassData] = useState<EditDialogClassData | null>(null);

  // Log user session details
  console.log("[ClassesPage] User Session:", JSON.stringify(user));
  console.log("[ClassesPage] Session Status:", sessionStatus);

  // Check if user is STAFF or FACULTY (used for Add/Delete buttons broadly)
  const canManageClasses = user?.role === UserRole.STAFF || user?.role === UserRole.FACULTY;
  console.log("[ClassesPage] Calculated canManageClasses:", canManageClasses);

  // Extracted fetch function
  const fetchClasses = async () => {
      // If session is still loading or no token, wait.
      if (sessionStatus === 'loading' || !token) {
          console.log("[fetchClasses] Waiting for session or token...");
          // Optionally set loading true if not already set by effect
          // setIsFetchingData(true);
          return; 
      }
      
      console.log("[fetchClasses] Token found, attempting fetch...");
      setIsFetchingData(true);
      setError(null);
      let response: Response | null = null; // Keep track of response
      try {
        console.log("Fetching classes using NextAuth token...");
        response = await fetch('/api/classes', {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        // --- Check for 401 Unauthorized specifically --- 
        if (response.status === 401) {
            console.error("Token expired or invalid (401). Signing out.");
            toast.error("Your session has expired. Please log in again.");
            await signOut({ redirect: true, callbackUrl: '/auth/signin' }); // Force sign out and redirect
            // No need to throw error here, as we are navigating away
            return; // Stop further execution in this function
        }
        // --- End 401 Check ---

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          // Include status in the error message for clarity
          throw new Error(errorData.message || `HTTP error ${response.status}`);
        }
        
        const data: ClassData[] = await response.json();
        setClasses(data);
      } catch (err: unknown) {
        console.error("Error fetching classes:", err);
        // Avoid setting general error state if it was a 401 we already handled by signing out
        if (response?.status !== 401) { 
            // Type check added
            const message = err instanceof Error ? err.message : 'Failed to fetch classes.';
            setError(message);
            toast.error(message);
            setClasses([]); // Clear classes on error
        }
      } finally {
        // Only set loading false if we didn't trigger a sign out
        if (response?.status !== 401) {
           setIsFetchingData(false);
        }
      }
    };

  // Effect for initial data fetching
  useEffect(() => {
    if (sessionStatus === 'authenticated') {
        // Token might still be null briefly after status becomes authenticated
        // fetchClasses will handle the !token case inside
        fetchClasses();
    } else if (sessionStatus === 'unauthenticated') {
      setIsFetchingData(false);
      // Don't set error here, let potential redirects handle it
      // setError('Authentication required to view classes.');
      setClasses([]); // Clear classes if unauthenticated
    }
    // Dependency array: run when session status changes
  }, [sessionStatus]); // Remove token from dependency array, rely on check inside fetchClasses

  const handleClassAdded = (/* newClass: ClassData */) => { // Parameter no longer needed
    // Instead of adding locally, refetch the list to get complete data
    console.log("[handleClassAdded] New class added, refetching list...");
    fetchClasses();
  };

  const handleDeleteClass = async (classId: string, classIdentifier: string) => {
    const currentToken = session?.accessToken;
    if (!currentToken || !canManageClasses) return;

    setIsDeleting(classId);
    console.log(`Attempting to delete class ${classIdentifier} (ID: ${classId})`);

    try {
      const response = await fetch(`/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${currentToken}` },
      });

      if (response.status === 204) {
        toast.success(`Class ${classIdentifier} deleted successfully.`);
        setClasses(prevClasses => prevClasses.filter(c => c.id !== classId));
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to delete class (Status: ${response.status})`);
      }
    } catch (err: unknown) {
      console.error("Error deleting class:", err);
      // Type check added
      const message = err instanceof Error ? err.message : 'Could not delete class.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsDeleting(null);
    }
  };

  // Handler to open the Edit dialog
  const handleOpenEditDialog = (classToEdit: ClassData) => {
     const dialogData: EditDialogClassData = {
        id: classToEdit.id,
        courseCode: classToEdit.courseCode,
        section: classToEdit.section,
        semester: ['FIRST', 'SECOND', 'SUMMER'].includes(classToEdit.semester) 
                  ? classToEdit.semester as 'FIRST' | 'SECOND' | 'SUMMER' 
                  : 'FIRST', 
        academicYear: classToEdit.academicYear,
        isActive: classToEdit.isActive,
        ficId: classToEdit.fic?.id ?? null,
        fic: classToEdit.fic ? { id: classToEdit.fic.id, name: classToEdit.fic.name } : undefined,
     };
    setEditingClassData(dialogData);
    setIsEditDialogOpen(true);
  };

  // Update handler: Close dialog and re-fetch class list
  const handleClassUpdated = () => {
     console.log("Edit successful, closing dialog and re-fetching classes...");
     setIsEditDialogOpen(false); 
     setEditingClassData(null); 
     // Re-fetch data to show updates
     fetchClasses(); 
     // Toast message is likely handled within EditClassDialog
  };

  const isLoading = sessionStatus === 'loading' || isFetchingData;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-destructive py-10">Error: {error}</div>;
  }

  if (sessionStatus === 'unauthenticated') {
    return <div className="text-center text-muted-foreground py-10">Please log in to view classes.</div>;
  }

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Classes</h1>
        {canManageClasses && (
          <AddClassDialog onClassAdded={handleClassAdded} />
        )}
      </div>

      <div className="border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Course Code</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Semester</TableHead>
              <TableHead>Academic Year</TableHead>
              <TableHead>Faculty</TableHead>
              <TableHead>Students</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No classes found.
                </TableCell>
              </TableRow>
            ) : (
              classes.map((cls) => {
                const classIdentifier = `${cls.courseCode} ${cls.section} (${cls.semester} ${cls.academicYear})`;
                const isCurrentlyDeleting = isDeleting === cls.id;
                
                // Log data for this specific row
                console.log(`[ClassesPage Row ${cls.id}] FIC ID:`, cls.fic?.id, " | User ID:", user?.id);
                
                return (
                  <TableRow key={cls.id}>
                    <TableCell className="font-medium">{cls.courseCode}</TableCell>
                    <TableCell>{cls.section}</TableCell>
                    <TableCell>{cls.semester}</TableCell>
                    <TableCell>{cls.academicYear}</TableCell>
                    <TableCell>{cls.fic?.name ?? cls.fic?.email ?? 'N/A'}</TableCell>
                    <TableCell>{cls._count.enrollments}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="mr-2" asChild>
                        <Link href={`/classes/${cls.id}`}>View</Link>
                      </Button>
                      
                      {/* Edit Button: Enabled for STAFF or FACULTY (same as Delete) */} 
                      {canManageClasses && (
                         <Button 
                            variant="outline" 
                            size="sm" 
                            className="mr-2" 
                            onClick={() => handleOpenEditDialog(cls)} 
                            title="Edit Class"
                          >
                           <Edit className="h-4 w-4" /> 
                           <span className="sr-only">Edit</span> 
                         </Button>
                      )}
                         
                      {/* Delete Button: Uses canManageClasses */} 
                      {canManageClasses && (
                        <AlertDialog>
                           <AlertDialogTrigger asChild>
                             <Button 
                               variant="destructive" 
                               size="sm" 
                               disabled={isCurrentlyDeleting}
                               title="Delete Class"
                               >
                                {isCurrentlyDeleting ? <LoadingSpinner size="sm"/> : <Trash2 className="h-4 w-4" />} 
                                <span className="sr-only">Delete</span>
                              </Button>
                           </AlertDialogTrigger>
                           <AlertDialogContent>
                             <AlertDialogHeader>
                               <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                               <AlertDialogDescription>
                                 This action cannot be undone. This will permanently delete the class 
                                 <span className="font-semibold"> {classIdentifier}</span> and all its enrollments.
                               </AlertDialogDescription>
                             </AlertDialogHeader>
                             <AlertDialogFooter>
                               <AlertDialogCancel>Cancel</AlertDialogCancel>
                               <AlertDialogAction 
                                   onClick={() => handleDeleteClass(cls.id, classIdentifier)}
                                   className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                               >
                                   Continue Deletion
                               </AlertDialogAction>
                             </AlertDialogFooter>
                           </AlertDialogContent>
                         </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Render Edit Class Dialog conditionally */} 
      {editingClassData && (
         <EditClassDialog
            classData={editingClassData} 
            isOpen={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen} 
            onClassUpdated={handleClassUpdated} 
          />
      )}
    </div>
  );
} 