'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, Search } from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface SelectableUser {
  id: string;
  name: string | null;
  email: string | null;
}

type AddStudentDialogProps = {
  classId: string; 
  enrolledStudentIds: string[];
  onStudentsAdded: () => void;
};

export default function AddStudentDialog({ classId, enrolledStudentIds, onStudentsAdded }: AddStudentDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingUsers, setIsFetchingUsers] = useState(false);
  const [allAvailableUsers, setAllAvailableUsers] = useState<SelectableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<SelectableUser[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.accessToken;

  useEffect(() => {
    const fetchUsers = async () => {
      if (isOpen && sessionStatus === 'authenticated' && token) {
        setIsFetchingUsers(true);
        setSearchTerm('');
        setSelectedStudentIds([]);
        console.log("Fetching REGULAR users for enrollment...");
        try {
          const response = await fetch('/api/users?role=REGULAR', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw new Error('Failed to fetch eligible users');
          const regularUsers: SelectableUser[] = await response.json();
          
          const available = regularUsers.filter(user => !enrolledStudentIds.includes(user.id));
          setAllAvailableUsers(available);
          setFilteredUsers(available);
          console.log("Available REGULAR users for enrollment:", available.length);

        } catch (error) {
          console.error("Error fetching users:", error);
          toast.error("Could not load user list.");
          setAllAvailableUsers([]); 
          setFilteredUsers([]);
        } finally {
             setIsFetchingUsers(false);
        }
      }
    };
    fetchUsers();
  }, [isOpen, sessionStatus, token, enrolledStudentIds]);

  useEffect(() => {
      if (!searchTerm) {
          setFilteredUsers(allAvailableUsers);
      } else {
          const lowerCaseSearch = searchTerm.toLowerCase();
          setFilteredUsers(
              allAvailableUsers.filter(user => 
                  user.name?.toLowerCase().includes(lowerCaseSearch) || 
                  user.email?.toLowerCase().includes(lowerCaseSearch)
              )
          );
      }
  }, [searchTerm, allAvailableUsers]);

  const handleCheckboxChange = (userId: string, checked: boolean) => {
    setSelectedStudentIds(prev => 
        checked ? [...prev, userId] : prev.filter(id => id !== userId)
    );
  };

  const handleBulkEnroll = async () => {
    if (selectedStudentIds.length === 0) {
      toast.warning('Please select at least one student to enroll.');
      return;
    }
    const currentToken = session?.accessToken;
    if (!currentToken) {
          toast.error('Authentication session is invalid. Please log in again.');
      return;
    }

    setIsLoading(true);
    console.log(`Bulk enrolling ${selectedStudentIds.length} users into class ${classId}`);

    try {
      const response = await fetch(`/api/classes/${classId}/enrollments/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ userIds: selectedStudentIds }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to enroll students.');
      }

      toast.success(result.message || `${result.count} students enrolled successfully!`);
      onStudentsAdded();
      setIsOpen(false);
    } catch (error: unknown) {
      console.error('Error bulk enrolling students:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const isSessionLoading = sessionStatus === 'loading';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={isSessionLoading}>
          <UserPlus className="mr-2 h-4 w-4" /> Add Student(s)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Add Students to Class</DialogTitle>
          <DialogDescription>
            Select students to enroll. Use search to filter.
          </DialogDescription>
        </DialogHeader>
        <div className="relative pt-2">
             <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                type="search"
                placeholder="Search name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-full bg-background/50 focus:bg-background/80 border-border/50 focus:border-border"
                disabled={isFetchingUsers}
            />
        </div>

        <ScrollArea className="h-60 w-full my-4 border rounded-md">
             {isFetchingUsers ? (
                <div className="flex justify-center items-center h-full text-muted-foreground">
                    <LoadingSpinner size="sm" /> Loading students...
                </div>
            ) : filteredUsers.length === 0 ? (
                <div className="flex justify-center items-center h-full text-muted-foreground px-4 text-center">
                    {searchTerm ? `No students found matching "${searchTerm}".` : "No available students found."}
                </div>
            ) : (
                <div className="p-4 space-y-2">
                    {filteredUsers.map((user) => (
                        <div key={user.id} className="flex items-center space-x-3 hover:bg-muted/50 p-2 rounded-md">
                             <Checkbox
                                id={`select-${user.id}`}
                                checked={selectedStudentIds.includes(user.id)}
                                onCheckedChange={(checked) => handleCheckboxChange(user.id, !!checked)}
                                disabled={isLoading}
                             />
                             <label 
                                 htmlFor={`select-${user.id}`}
                                 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-grow cursor-pointer"
                             >
                                 {user.name} <span className="text-xs text-muted-foreground">({user.email})</span>
                             </label>
                         </div>
                     ))}
         </div>
            )}
        </ScrollArea>

        <DialogFooter>
            <div className="text-sm text-muted-foreground mr-auto">
                {selectedStudentIds.length} student(s) selected
            </div>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isLoading || isSessionLoading}>
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={handleBulkEnroll} 
            disabled={isLoading || selectedStudentIds.length === 0 || isFetchingUsers || isSessionLoading}
          >
            {isLoading ? <LoadingSpinner size="sm" /> : `Enroll Selected (${selectedStudentIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 