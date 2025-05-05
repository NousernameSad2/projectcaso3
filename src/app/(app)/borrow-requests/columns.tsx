'use client'

import { ColumnDef, RowData } from "@tanstack/react-table"
import { Borrow, BorrowStatus, User, Equipment, Class } from "@prisma/client" // Import base types
import { format } from 'date-fns'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button" // Import Button
import { ArrowUpDown, MoreHorizontal } from "lucide-react" // For sorting/actions icons
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu" // For actions menu
import { toast } from "sonner"; // Add toast import

// Define the type here (moved from page.tsx)
export type BorrowRequestAdminView = Borrow & {
  borrowGroupId?: string | null; // Explicitly add borrowGroupId
  borrower: Pick<User, 'id' | 'name' | 'email'>;
  equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId'>;
  class: Pick<Class, 'id' | 'courseCode' | 'section' | 'semester'>;
};

// Helper function to get badge variant based on status (can be expanded)
const getStatusVariant = (status: BorrowStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case BorrowStatus.PENDING:
      return "warning"
    case BorrowStatus.APPROVED:
      return "secondary"
    case BorrowStatus.ACTIVE:
      return "success"
    case BorrowStatus.RETURNED:
    case BorrowStatus.COMPLETED:
      return "default"
    case BorrowStatus.REJECTED_FIC:
    case BorrowStatus.REJECTED_STAFF:
    case BorrowStatus.CANCELLED:
    case BorrowStatus.OVERDUE:
      return "destructive"
    default:
      return "outline"
  }
}

// Define columns using ColumnDef
// Extend ColumnMeta if using meta - defines the shape of the meta object
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    approveGroupHandler?: (borrowGroupId: string | null | undefined) => Promise<void>
    rejectGroupHandler?: (borrowGroupId: string | null | undefined) => Promise<void>
    confirmCheckoutGroupHandler?: (borrowGroupId: string | null | undefined) => Promise<void>
    approveItemHandler?: (borrowId: string | null | undefined) => Promise<void>
    rejectItemHandler?: (borrowId: string | null | undefined) => Promise<void>
    openConfirmReturnModalHandler?: (borrowRequest: BorrowRequestAdminView | null | undefined) => void
    isSubmittingAction?: boolean
    confirmReturnGroupHandler?: (borrowGroupId: string | null | undefined) => Promise<void>
    // Add other handlers/state as needed
  }
}

export const columns: ColumnDef<BorrowRequestAdminView>[] = [
  // Optional: Selection Checkbox column
  // {
  //   id: "select",
  //   header: ({ table }) => (
  //     <Checkbox
  //       checked={
  //         table.getIsAllPageRowsSelected() ||
  //         (table.getIsSomePageRowsSelected() && "indeterminate")
  //       }
  //       onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
  //       aria-label="Select all"
  //     />
  //   ),
  //   cell: ({ row }) => (
  //     <Checkbox
  //       checked={row.getIsSelected()}
  //       onCheckedChange={(value) => row.toggleSelected(!!value)}
  //       aria-label="Select row"
  //     />
  //   ),
  //   enableSorting: false,
  //   enableHiding: false,
  // },
  {
    accessorKey: "borrower.name",
    id: "borrower.name",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Borrower
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => (
       <div className="font-medium">{row.original.borrower.name || 'N/A'}</div>
    ),
  },
  {
    accessorKey: "equipment.name",
     header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Equipment
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => <div>{row.original.equipment.name}</div>,
  },
  {
    accessorKey: "class", // Access the whole class object for display
    header: "Class",
    cell: ({ row }) => {
      const borrower = row.original.borrower;
      const cls = row.original.class; // cls can be null

      return (
        <div className="text-xs space-y-1">
          {borrower && (
            <div>
              <span className="font-medium">Borrower:</span> {borrower.name} ({borrower.email})
            </div>
          )}
          {cls && (
            <div>
              <span className="font-medium">Class:</span> {cls.courseCode}-{cls.section} ({cls.semester})
            </div>
          )}
           {!borrower && !cls && <span className="text-muted-foreground italic">No borrower/class info</span>}
        </div>
      );
    },
    // Disable sorting/filtering on this complex object by default
    enableSorting: false,
    enableColumnFilter: false,
  },
  {
    accessorKey: "borrowStatus",
    id: "borrowStatus",
     header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Status
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
       const status = row.getValue("borrowStatus") as BorrowStatus
       return (
         <Badge variant={getStatusVariant(status)} className="capitalize">
           {status.toLowerCase().replace(/_/g, ' ')}
         </Badge>
       )
    },
    filterFn: 'equals', // Enable basic status filtering later
  },
  {
    accessorKey: "requestSubmissionTime",
     header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Requested On
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
       const dateValue = row.getValue("requestSubmissionTime")
       // Ensure the value is valid before formatting
       try {
          const date = new Date(dateValue as string | number | Date) // Cast needed
          return <div>{format(date, 'PPp')}</div>
       } catch {
          console.error("Invalid date value:", dateValue);
          return <div>Invalid Date</div>
       }
    },
  },
   {
     accessorKey: "borrowGroupId",
     header: "Group ID",
     cell: ({ row }) => (
       <div className="text-xs text-muted-foreground truncate" title={row.original.borrowGroupId || 'N/A'}>
         {row.original.borrowGroupId || '-'}
       </div>
     ),
     enableSorting: false,
   },
  {
    id: "actions",
    cell: ({ row, table }) => { // Access table instance to get meta
      const borrowRequest = row.original
      const isGroupRequest = !!borrowRequest.borrowGroupId
      const canApproveOrRejectGroup = borrowRequest.borrowStatus === BorrowStatus.PENDING && isGroupRequest
      const canConfirmCheckoutGroup = borrowRequest.borrowStatus === BorrowStatus.APPROVED && isGroupRequest
      const canConfirmReturnGroup = borrowRequest.borrowStatus === BorrowStatus.PENDING_RETURN && isGroupRequest // Check for bulk return
      const canConfirmReturn = borrowRequest.borrowStatus === BorrowStatus.PENDING_RETURN // Individual return check (already exists)
      const isPendingItem = borrowRequest.borrowStatus === BorrowStatus.PENDING
      
      // Get handler from meta
      const approveGroupHandler = table.options.meta?.approveGroupHandler
      const rejectGroupHandler = table.options.meta?.rejectGroupHandler
      const confirmCheckoutHandler = table.options.meta?.confirmCheckoutGroupHandler
      const confirmReturnGroupHandler = table.options.meta?.confirmReturnGroupHandler // Get the new handler
      const approveItemHandler = table.options.meta?.approveItemHandler
      const rejectItemHandler = table.options.meta?.rejectItemHandler
      const confirmReturnModalOpener = table.options.meta?.openConfirmReturnModalHandler
      const isSubmitting = table.options.meta?.isSubmittingAction

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0" disabled={isSubmitting}>
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem 
               onClick={async () => { // Make async
                 if (!navigator.clipboard) {
                   toast.error("Clipboard API not available.");
                   return;
                 }
                 try {
                   await navigator.clipboard.writeText(borrowRequest.id);
                   toast.success("Request ID copied!");
                 } catch (err) {
                   console.error("Copy failed:", err);
                   toast.error("Failed to copy Request ID.");
                 }
               }}
               disabled={isSubmitting} 
            >
              Copy Request ID
            </DropdownMenuItem>
            {isGroupRequest && (
              <DropdownMenuItem 
                 onClick={async () => { // Make async
                   if (!navigator.clipboard) {
                     toast.error("Clipboard API not available.");
                     return;
                   }
                   try {
                     await navigator.clipboard.writeText(borrowRequest.borrowGroupId!);
                     toast.success("Group ID copied!");
                   } catch (err) {
                     console.error("Copy failed:", err);
                     toast.error("Failed to copy Group ID.");
                   }
                 }}
                 disabled={isSubmitting} 
              >
                Copy Group ID ({borrowRequest.borrowGroupId?.substring(0, 6)}...)
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>View Details</DropdownMenuItem> 
            
            {/* Group Actions */} 
            {isGroupRequest && <DropdownMenuSeparator />} 
            {canApproveOrRejectGroup && (
              <DropdownMenuItem
                onClick={() => approveGroupHandler?.(borrowRequest.borrowGroupId)}
                disabled={isSubmitting}
                className="text-green-600 focus:text-green-700 focus:bg-green-50"
              >
                Approve ENTIRE Group Request
              </DropdownMenuItem>
            )}
            {canApproveOrRejectGroup && (
              <DropdownMenuItem
                onClick={() => rejectGroupHandler?.(borrowRequest.borrowGroupId)} 
                disabled={isSubmitting} 
                className="text-red-600 focus:text-red-700 focus:bg-red-50"
              >
                Reject ENTIRE Group Request
              </DropdownMenuItem>
            )}
            {canConfirmCheckoutGroup && (
               <DropdownMenuItem
                 onClick={() => confirmCheckoutHandler?.(borrowRequest.borrowGroupId)}
                 disabled={isSubmitting} 
                 className="text-blue-600 focus:text-blue-700 focus:bg-blue-50"
               >
                 Confirm ENTIRE Group Checkout
               </DropdownMenuItem>
            )}
            {canConfirmReturnGroup && (
               <DropdownMenuItem
                 onClick={() => confirmReturnGroupHandler?.(borrowRequest.borrowGroupId)}
                 disabled={isSubmitting}
                 className="text-purple-600 focus:text-purple-700 focus:bg-purple-50"
               >
                 Confirm ENTIRE Group Return
               </DropdownMenuItem>
            )}

            {/* Individual Actions */} 
            {(isPendingItem || canConfirmReturn) && <DropdownMenuSeparator />} 
            {/* Individual Approve/Reject */} 
            {isPendingItem && (
               <> 
                  <DropdownMenuItem
                     onClick={() => approveItemHandler?.(borrowRequest.id)}
                     disabled={isSubmitting}
                     className="text-green-500 focus:text-green-600"
                   >
                      Approve This Item Only
                  </DropdownMenuItem>
                  <DropdownMenuItem
                     onClick={() => rejectItemHandler?.(borrowRequest.id)}
                     disabled={isSubmitting}
                     className="text-red-500 focus:text-red-600"
                   >
                      Reject This Item Only
                  </DropdownMenuItem>
               </>
            )}

            {/* Individual Confirm Return */} 
            {canConfirmReturn && (
               <DropdownMenuItem
                 onClick={() => confirmReturnModalOpener?.(borrowRequest)} 
                 disabled={isSubmitting} 
                 className="text-purple-600 focus:text-purple-700 focus:bg-purple-50"
               >
                 Confirm Return (This Item)
               </DropdownMenuItem>
            )}
            {/* TODO: Individual Confirm Checkout? (Less common if groups used) */} 
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
    enableSorting: false,
    enableHiding: false,
  },
] 