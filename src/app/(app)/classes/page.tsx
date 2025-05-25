'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  // State for filter
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // Log user session details
  console.log("[ClassesPage] User Session:", JSON.stringify(user));
  console.log("[ClassesPage] Session Status:", sessionStatus);

  // Check if user is STAFF or FACULTY (used for Add/Delete buttons broadly)
  const canManageClasses = user?.role === UserRole.STAFF || user?.role === UserRole.FACULTY;
  console.log("[ClassesPage] Calculated canManageClasses:", canManageClasses);

  // Extracted fetch function
  const fetchClasses = useCallback(async (currentFilterStatus: 'all' | 'active' | 'inactive') => {
      console.log(`[ClassesPage - fetchClasses] Attempting fetch. Session status: ${sessionStatus}, Filter: ${currentFilterStatus}`);
      if (sessionStatus !== 'authenticated' || !token) {
          console.warn("[ClassesPage - fetchClasses] Pre-flight check failed: Not authenticated or no token. Session status:", sessionStatus, "Token available:", !!token);
          setIsFetchingData(false); 
          setClasses([]); 
          return;
      }
      
      console.log(`[ClassesPage - fetchClasses] Token found. Token (first 30 chars): ${token ? token.substring(0, 30) + '...' : 'N/A'}`);
      setIsFetchingData(true);
      setError(null);
      let response: Response | null = null; 
      
      let apiUrl = '/api/classes';
      if (currentFilterStatus === 'active') {
        apiUrl += '?isActive=true';
      } else if (currentFilterStatus === 'inactive') {
        apiUrl += '?isActive=false';
      }
      console.log(`[ClassesPage - fetchClasses] Fetching from API URL: ${apiUrl}`);
      
      try {
        response = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        console.log(`[ClassesPage - fetchClasses] API Response Status: ${response.status} for URL: ${apiUrl}`);

        if (response.status === 401) {
            console.error("[ClassesPage - fetchClasses] API returned 401 Unauthorized. Token may be invalid or expired. Forcing signOut.");
            toast.error("Your session has expired or is invalid. Please log in again.");
            await signOut({ redirect: true, callbackUrl: '/login' });
            return;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: "Failed to parse error JSON." }));
          console.error(`[ClassesPage - fetchClasses] API request failed. Status: ${response.status}, Response:`, errorData);
          throw new Error(errorData.message || `HTTP error ${response.status}`);
        }
        
        const data: ClassData[] = await response.json();
        console.log(`[ClassesPage - fetchClasses] Successfully fetched ${data.length} classes.`);
        setClasses(data);
      } catch (err: unknown) {
        if (!(response && response.status === 401)) {
            const message = err instanceof Error ? err.message : 'Failed to fetch classes due to an unexpected error.';
            console.error("[ClassesPage - fetchClasses] Catch block error:", message, "Original error:", err);
            setError(message);
            toast.error(message);
        }
        setClasses([]);
      } finally {
        if (!(response && response.status === 401)) {
           setIsFetchingData(false);
           console.log("[ClassesPage - fetchClasses] Fetch operation complete (setIsFetchingData(false)).");
        }
      }
    }, [sessionStatus, token]); // Dependencies for useCallback: sessionStatus and token

  // Effect for initial data fetching and when filter changes
  useEffect(() => {
    console.log(`[ClassesPage - useEffect] Triggered. Session status: ${sessionStatus}, Filter: ${filterStatus}`);
    if (sessionStatus === 'authenticated') {
      console.log("[ClassesPage - useEffect] Session authenticated, calling fetchClasses.");
      fetchClasses(filterStatus); 
    } else if (sessionStatus === 'unauthenticated') {
      console.warn("[ClassesPage - useEffect] Session unauthenticated. Clearing data and not fetching.");
      setIsFetchingData(false);
      setClasses([]);
    } else {
      console.log("[ClassesPage - useEffect] Session status is pending ('loading'). Waiting.");
    }
    // fetchClasses is stable due to useCallback, filterStatus and sessionStatus are prime triggers.
  }, [sessionStatus, filterStatus, fetchClasses]);

  const handleClassAdded = () => {
    console.log("[handleClassAdded] New class added, refetching list with current filter...");
    fetchClasses(filterStatus); // Refetch with current filter
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
     console.log("Edit successful, closing dialog and re-fetching classes with current filter...");
     setIsEditDialogOpen(false); 
     setEditingClassData(null); 
     fetchClasses(filterStatus); // Refetch with current filter
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
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-foreground">Manage Classes</h1>
        {canManageClasses && (
          <AddClassDialog onClassAdded={handleClassAdded} />
        )}
      </div>

      <Tabs 
        value={filterStatus} 
        onValueChange={(value: string) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
        className="mb-6"
      >
        <TabsList className="grid w-full grid-cols-3 md:w-[400px]">
          <TabsTrigger value="all">All Classes</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>
      </Tabs>

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
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No classes found matching the current filter.
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
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          cls.isActive 
                            ? 'bg-green-500 text-white dark:bg-green-600 dark:text-green-100' 
                            : 'bg-red-500 text-white dark:bg-red-700 dark:text-red-100'
                      }`}>
                          {cls.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
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