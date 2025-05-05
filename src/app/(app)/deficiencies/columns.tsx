'use client'

import { ColumnDef, RowData } from "@tanstack/react-table"
import { Deficiency, DeficiencyStatus, User, Equipment } from "@prisma/client"; import { format } from 'date-fns'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"

// Define the shape of the data expected from the API
export type DeficiencyAdminView = Deficiency & {
  user: Pick<User, 'id' | 'name' | 'email'>; // User responsible
  taggedBy: Pick<User, 'id' | 'name'>; // Admin who tagged
  borrow: { 
    id: string; 
    equipment: Pick<Equipment, 'id' | 'name' | 'equipmentId'> 
  };
  // ficToNotify?: Pick<User, 'id' | 'name'> | null;
};

// Helper for status badges (similar to borrow status)
const getDeficiencyStatusVariant = (status: DeficiencyStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | undefined => {
   switch (status) {
     case DeficiencyStatus.UNRESOLVED: return "warning";
     case DeficiencyStatus.UNDER_REVIEW: return "secondary";
     case DeficiencyStatus.RESOLVED: return "success";
     default: return "outline"; // Default to outline or undefined
   }
}

// TableMeta definition for actions
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    resolveDeficiencyHandler?: (deficiencyId: string) => Promise<void>;
    deleteDeficiencyHandler?: (deficiencyId: string) => Promise<void>;
    openDetailsModalHandler?: (deficiencyId: string) => void;
    isSubmittingAction?: boolean;
    // Add other handlers if needed
  }
}

export const columns: ColumnDef<DeficiencyAdminView>[] = [
  {
    accessorKey: "user.name",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        User Responsible <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => <div>{row.original.user.name}</div>,
  },
  {
    accessorKey: "borrow.equipment.name",
    header: "Equipment",
    cell: ({ row }) => <div>{row.original.borrow.equipment.name}</div>,
    enableSorting: false, // Sorting on nested prop is tricky
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <div className="capitalize">{(row.getValue("type") as string).toLowerCase().replace(/_/g, ' ')}</div>,
  },
  {
    accessorKey: "status",
    id: "status",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Status <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <Badge variant={getDeficiencyStatusVariant(row.getValue("status") as DeficiencyStatus)} className="capitalize">
        {(row.getValue("status") as string).toLowerCase().replace(/_/g, ' ')}
      </Badge>
    ),
    filterFn: 'equals',
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="max-w-[300px] truncate" title={row.getValue("description") || ''}>
         {row.getValue("description") || '-'}
      </div>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "taggedBy.name",
    header: "Tagged By",
    cell: ({ row }) => <div>{row.original.taggedBy.name}</div>,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Logged On <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => <div>{format(new Date(row.getValue("createdAt")), 'PPp')}</div>,
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const deficiency = row.original
      const resolveHandler = table.options.meta?.resolveDeficiencyHandler
      const deleteHandler = table.options.meta?.deleteDeficiencyHandler
      const openDetailsHandler = table.options.meta?.openDetailsModalHandler
      const isSubmitting = table.options.meta?.isSubmittingAction
      const canResolve = deficiency.status === DeficiencyStatus.UNRESOLVED || deficiency.status === DeficiencyStatus.UNDER_REVIEW

      // --- Add Log --- 
      console.log(`[Deficiency Actions Cell] Rendering actions for ${deficiency.id}. isSubmitting:`, isSubmitting);

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0" disabled={isSubmitting}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem 
                onClick={() => openDetailsHandler?.(deficiency.id)} 
                disabled={isSubmitting}
            >
                View Details
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={async () => {
                if (!navigator.clipboard) {
                  toast.error("Clipboard API not available in this context (requires HTTPS or localhost).");
                  return;
                }
                try {
                  await navigator.clipboard.writeText(deficiency.id);
                  toast.success("Deficiency ID copied to clipboard!");
                } catch (err) {
                  console.error("Failed to copy text: ", err);
                  toast.error("Failed to copy Deficiency ID.");
                }
              }}
              disabled={isSubmitting}
            >
              Copy Deficiency ID
            </DropdownMenuItem>
            {(canResolve) && <DropdownMenuSeparator />}
            {canResolve && (
              <DropdownMenuItem
                onClick={() => resolveHandler?.(deficiency.id)}
                disabled={isSubmitting}
                className="text-green-600 focus:text-green-700 focus:bg-green-50"
              >
                Mark as Resolved
              </DropdownMenuItem>
            )}
            {/* Add other actions later: e.g., Set Under Review, Add Resolution Note */} 
            
            {/* Add Delete Action */} 
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => deleteHandler?.(deficiency.id)} 
              disabled={isSubmitting}
              className="text-destructive focus:text-destructive-foreground focus:bg-destructive/90"
            >
              Delete Record
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
    enableSorting: false,
  },
]; 