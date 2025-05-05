'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Trash2, Edit, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import Link from 'next/link';
import { UserRole, UserStatus } from '@prisma/client';
import AddStudentDialog from '@/components/classes/AddStudentDialog';
import { EditClassDialog } from '@/components/classes/EditClassDialog';
import { useSession } from 'next-auth/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Define the structure for enrolled user data within the class details
interface EnrolledUser {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
}

// Define the structure for the full class detail data from API
interface ClassDetailData {
  id: string;
  courseCode: string;
  section: string;
  semester: 'FIRST' | 'SECOND' | 'SUMMER' | string;
  academicYear: string | null;
  isActive: boolean;
  fic: {
    id: string;
    name: string | null;
    email: string | null;
    firstName?: string;
    lastName?: string;
  } | null;
  enrollments: { user: EnrolledUser }[];
  createdAt: string;
  updatedAt: string;
}

// --- Types for client-side sorting ---
type EnrolledSortField = 'name' | 'email';
type SortOrder = 'asc' | 'desc';
// -------------------------------------

export default function ClassDetailPage() {
  const params = useParams();
  const classId = params.id as string;
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.accessToken;
  const user = session?.user;
  const [classDetails, setClassDetails] = useState<ClassDetailData | null>(null);
  const [isFetchingDetails, setIsFetchingDetails] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // --- State for sorting enrolled students ---
  const [enrolledSortBy, setEnrolledSortBy] = useState<EnrolledSortField>('name');
  const [enrolledSortOrder, setEnrolledSortOrder] = useState<SortOrder>('asc');
  // -----------------------------------------

  // --- State for Delete Confirmation Dialog --- 
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
  const [removingStudent, setRemovingStudent] = useState<{ id: string; name: string | null } | null>(null);
  const [isRemovingStudent, setIsRemovingStudent] = useState(false);
  // -------------------------------------------

  const isStaff = user?.role === UserRole.STAFF;
  const isFIC = user?.role === UserRole.FACULTY && classDetails?.fic?.id === user?.id;
  const canEditClass = isStaff || isFIC; 
  const canManageEnrollments = isStaff || isFIC;

  // --- Refetch Function --- (Extracted for reuse)
  const fetchClassDetails = useCallback(async () => {
    if (!(sessionStatus === 'authenticated' && token && classId)) {
        console.log("[ClassDetail] Refetch aborted: Invalid state.");
        return;
    }
    console.log(`[ClassDetail] Re/Fetching details for class ${classId}...`);
            setIsFetchingDetails(true);
            setError(null);
            try {
                const response = await fetch(`/api/classes/${classId}`, {
                headers: { Authorization: `Bearer ${token}` },
                });
        console.log(`[ClassDetail] (Re)Fetch API Response Status: ${response.status}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
            console.error("[ClassDetail] (Re)Fetch API Error Data:", errorData);
                        throw new Error(errorData.message || `HTTP error ${response.status}`);
                    }
                    const data = await response.json();
        console.log("[ClassDetail] (Re)Fetch API Success Data:", data);
                    if (data && data.id) {
                        setClassDetails(data);
                    } else {
            throw new Error('Invalid data received from API.');
                }
            } catch (err: unknown) {
        console.error("[ClassDetail] Error during refetch:", err);
        const message = err instanceof Error ? err.message : 'Failed to reload class details.';
        setError(message);
        toast.error(message);
            } finally {
                setIsFetchingDetails(false);
    }
  }, [classId, sessionStatus, token]);

  // --- Initial Fetch Effect ---
  useEffect(() => {
    fetchClassDetails();
  }, [fetchClassDetails]);

  // --- Student Management Handlers --- 
  const handleStudentsAdded = () => {
    console.log("[ClassDetail] Bulk enrollment successful, re-fetching details...");
    fetchClassDetails();
  };

  // --- Modified handleRemoveStudent to open dialog ---
  const openRemoveConfirmation = (studentId: string, studentName: string | null) => {
    setRemovingStudent({ id: studentId, name: studentName });
    setIsRemoveConfirmOpen(true);
  };

  // --- Actual student removal logic (extracted) ---
  const performRemoveStudent = async () => {
    if (!removingStudent || !token) return;
    const studentId = removingStudent.id;
    const studentName = removingStudent.name;

    setIsRemovingStudent(true);
    try {
      const response = await fetch(`/api/classes/${classId}/enrollments?userId=${studentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Check for successful 204 No Content first
      if (response.status === 204) {
        toast.success(`Student ${studentName || 'ID: ' + studentId} removed successfully.`);
      } else if (!response.ok) {
        // If not 204 and not OK, try to parse error JSON
        const errorResult = await response.json().catch(() => ({})); // Attempt to parse error JSON
        throw new Error(errorResult.message || `Failed to remove student (Status: ${response.status})`);
      } else {
        // Handle unexpected OK statuses (like 200) if they shouldn't happen
        console.warn("Unexpected successful status code from DELETE enrollment:", response.status);
        toast.success(`Student ${studentName || 'ID: ' + studentId} removed (Status: ${response.status}).`);
      }

      // Refetch details regardless of exact success status (if response.ok or 204)
      fetchClassDetails();
      setIsRemoveConfirmOpen(false);
      setRemovingStudent(null);

    } catch (err: unknown) {
        console.error("Error removing student:", err);
        const message = err instanceof Error ? err.message : 'Could not remove student.';
        toast.error(`Error: ${message}`);
    } finally {
        setIsRemovingStudent(false);
    }
  };

  // --- Class Management Handlers ---
  const handleEditClass = () => {
    setIsEditOpen(true); 
  };

  const handleClassUpdated = () => {
    console.log("[ClassDetail] Edit successful, re-fetching details...");
    setIsEditOpen(false); 
    fetchClassDetails();
  };

  // --- Handler for sorting enrolled students ---
  const handleEnrolledSort = (field: EnrolledSortField) => {
      const newOrder = enrolledSortBy === field && enrolledSortOrder === 'asc' ? 'desc' : 'asc';
      setEnrolledSortBy(field);
      setEnrolledSortOrder(newOrder);
  };
  // --------------------------------------------

  // --- Memoized sorted student list ---
  const sortedEnrolledStudents = useMemo(() => {
    if (!classDetails?.enrollments) return [];
    
    const studentsToSort = [...classDetails.enrollments]; 

    studentsToSort.sort((a, b) => {
        const valA = a.user[enrolledSortBy] ?? '';
        const valB = b.user[enrolledSortBy] ?? '';
        
        const comparison = valA.localeCompare(valB, undefined, { sensitivity: 'base' });
        
        return enrolledSortOrder === 'asc' ? comparison : -comparison;
    });

    return studentsToSort;
  }, [classDetails?.enrollments, enrolledSortBy, enrolledSortOrder]);
  // ------------------------------------

  // --- Helper for Sortable Header (similar to AdminUsersPage) ---
  const renderEnrolledSortableHeader = (field: EnrolledSortField, label: string) => (
      <Button
          variant="ghost"
          onClick={() => handleEnrolledSort(field)}
          className="px-2 py-1 -ml-2 text-left hover:bg-muted/30"
      >
          {label}
          {enrolledSortBy === field ? (
              enrolledSortOrder === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
              <ArrowUpDown className="ml-2 h-4 w-4 opacity-30" />
          )}
      </Button>
  );
  // --------------------------------------------------------

  // --- Render Logic --- 
  const isLoading = sessionStatus === 'loading' || isFetchingDetails;

  if (isLoading) {
    return <div className="flex justify-center items-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>;
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-destructive mb-4">Error: {error}</p>
        <Button variant="outline" asChild>
            <Link href="/classes" legacyBehavior>
                <ArrowLeft className="mr-2 h-4 w-4"/> Go back to Classes
            </Link>
        </Button>
      </div>
    );
  }

  if (sessionStatus === 'unauthenticated') {
       return <div className="text-center text-muted-foreground py-10">Please log in to view class details.</div>;
  }

  if (!classDetails) {
    return <div className="text-center py-10 text-muted-foreground">Class details not available.</div>;
  }

  const editDialogData = classDetails ? {
     id: classDetails.id,
     courseCode: classDetails.courseCode,
     section: classDetails.section,
     semester: ['FIRST', 'SECOND', 'SUMMER'].includes(classDetails.semester) 
                 ? classDetails.semester as 'FIRST' | 'SECOND' | 'SUMMER' 
                 : 'FIRST', 
     academicYear: classDetails.academicYear ?? '',
     isActive: classDetails.isActive,
     ficId: classDetails.fic?.id ?? null,
  } : null;

  return (
    <div className="container mx-auto py-10 space-y-6">
      <div className="flex items-center justify-between">
         <Button variant="outline" size="icon" asChild>
           <Link href="/classes" legacyBehavior>
               <ArrowLeft className="h-4 w-4"/>
               <span className="sr-only">Back to Classes</span>
           </Link>
         </Button>
         <h1 className="text-2xl font-bold text-white text-center flex-1 mx-4 truncate">
           {classDetails.courseCode} - {classDetails.section} ({classDetails.semester})
         </h1>
         {canEditClass && (
            <Button variant="outline" size="icon" onClick={handleEditClass}>
               <Edit className="h-4 w-4"/>
               <span className="sr-only">Edit Class</span>
           </Button>
         )}
      </div>
      <Card className="bg-card/80 border-border">
        <CardHeader>
           <CardTitle>Class Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
           <div><span className="font-semibold text-muted-foreground">Course Code:</span> {classDetails.courseCode}</div>
           <div><span className="font-semibold text-muted-foreground">Section:</span> {classDetails.section}</div>
           <div><span className="font-semibold text-muted-foreground">Semester:</span> {classDetails.semester}</div>
           <div><span className="font-semibold text-muted-foreground">Academic Year:</span> {classDetails.academicYear ?? 'N/A'}</div>
           <div>
             <span className="font-semibold text-muted-foreground">Faculty in Charge:</span> 
             {classDetails.fic?.id ? (
               <Link
                 href={`/users/${classDetails.fic.id}/profile`}
                 className="hover:underline text-primary"
                 legacyBehavior>
                 {classDetails.fic.name ?? classDetails.fic.email}
               </Link>
             ) : (
               classDetails.fic?.name ?? classDetails.fic?.email ?? 'N/A'
             )}
           </div>
           <div><span className="font-semibold text-muted-foreground">Status:</span> {classDetails.isActive ? 'Active' : 'Inactive'}</div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>Enrolled Students ({sortedEnrolledStudents.length})</CardTitle>
            {canManageEnrollments && (
              <AddStudentDialog 
                classId={classId} 
                enrolledStudentIds={classDetails.enrollments.map(e => e.user.id)}
                onStudentsAdded={handleStudentsAdded}
              />
            )}
          </CardHeader>
          <CardContent>
            {isFetchingDetails ? (
                 <div className="text-center py-4"><LoadingSpinner /></div>
            ) : sortedEnrolledStudents.length === 0 ? (
                 <p className="text-center text-muted-foreground py-6">No students enrolled in this class yet.</p>
            ) : (
                <div className="border rounded-md overflow-hidden">
                     <Table>
                         <TableHeader>
                             <TableRow>
                                 <TableHead>{renderEnrolledSortableHeader('name', 'Name')}</TableHead>
                                 <TableHead>{renderEnrolledSortableHeader('email', 'Email')}</TableHead>
                                 <TableHead className="text-right">Actions</TableHead>
                             </TableRow>
                         </TableHeader>
                         <TableBody>
                             {sortedEnrolledStudents.map(({ user }) => (
                                 <TableRow key={user.id}>
                                     <TableCell className="font-medium">{user.name || "-"}</TableCell>
                                     <TableCell>{user.email || "-"}</TableCell>
                                     <TableCell className="text-right">
                                         {canManageEnrollments && (
                                             <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="text-destructive hover:bg-destructive/10" 
                                                onClick={() => openRemoveConfirmation(user.id, user.name)}
                                                disabled={isRemovingStudent && removingStudent?.id === user.id}
                                                title="Remove Student"
                                                >
                                                {(isRemovingStudent && removingStudent?.id === user.id) ? <LoadingSpinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                                                <span className="sr-only">Remove</span>
                                             </Button>
                                         )}
                                     </TableCell>
                                 </TableRow>
                             ))}
                         </TableBody>
                     </Table>
                 </div>
            )}
          </CardContent>
        </Card>
      {canEditClass && isEditOpen && editDialogData && (
          <EditClassDialog 
             classData={editDialogData} 
             isOpen={isEditOpen}
             onOpenChange={setIsEditOpen} 
             onClassUpdated={handleClassUpdated}
          />
      )}
      {/* --- Remove Student Confirmation Dialog --- */}
      <AlertDialog open={isRemoveConfirmOpen} onOpenChange={setIsRemoveConfirmOpen}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                      This action will remove the student 
                      <strong>{removingStudent?.name || removingStudent?.id}</strong> 
                      from this class. They will need to be added again manually if this was a mistake.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel disabled={isRemovingStudent}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                      onClick={performRemoveStudent}
                      disabled={isRemovingStudent}
                      className="bg-destructive hover:bg-destructive/90"
                  >
                      {isRemovingStudent ? <LoadingSpinner size="sm" className="mr-2" /> : null}
                      Confirm Remove
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      {/* --- End Remove Student Dialog --- */}
    </div>
  );
} 