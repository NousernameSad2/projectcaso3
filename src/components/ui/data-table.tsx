'use client'

import * as React from "react"
import {
  ColumnDef,
  type ColumnFiltersState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type TableMeta,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// import { Input } from "@/components/ui/input" // Removed Input import
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// import { BorrowStatus } from "@prisma/client" // Removed BorrowStatus import
import { cn } from "@/lib/utils"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: TableMeta<TData> // Changed to TableMeta<TData> | undefined (optional implies undefined)
  // Remove optional props for external filter state management
  // columnFilters?: ColumnFiltersState 
  // onColumnFiltersChange?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>
  columnFilters?: ColumnFiltersState // Use this prop
  onColumnFiltersChange?: React.Dispatch<React.SetStateAction<ColumnFiltersState>> // Use this prop
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  // Remove external filter state props
  // columnFilters: externalColumnFilters,
  // onColumnFiltersChange: setExternalColumnFilters,
  columnFilters: externalColumnFilters, // Destructure the prop
  onColumnFiltersChange: setExternalColumnFilters, // Destructure the prop
}: DataTableProps<TData, TValue>) {
  // Restore internal state management
  const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>([])
  
  // Use internal state
  // const columnFilters = internalColumnFilters;
  // const setColumnFilters = setInternalColumnFilters;

  // Remove determination logic
  // const columnFilters = externalColumnFilters ?? internalColumnFilters;
  // const setColumnFilters = setExternalColumnFilters ?? setInternalColumnFilters;

  // Determine whether to use internal or external state for column filters
  const isExternalFilters = externalColumnFilters !== undefined && setExternalColumnFilters !== undefined;
  const columnFilters = isExternalFilters ? externalColumnFilters : internalColumnFilters;
  const setColumnFilters = isExternalFilters ? setExternalColumnFilters : setInternalColumnFilters;


  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    meta, 
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    // Pass the internal state setter to the hook
    onColumnFiltersChange: setColumnFilters, 
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      // Pass the internal state to the hook
      columnFilters, 
    },
  })

  // Status Filter Options
  // const statusOptions = Object.values(BorrowStatus); // Removed unused statusOptions

  let currentGroupStyle = 'bg-transparent'; // Start with default
  let currentRenderedGroupId: string | null | undefined = undefined;

  return (
    <div>
       {/* REMOVE Filter Row */}
       {/* <div className="flex items-center justify-between py-4"> ... </div> */}
       
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => { // Removed unused _index
                 const rowData = row.original as TData & { borrowGroupId?: string | null }; // Typed rowData
                 const rowGroupId = rowData?.borrowGroupId;

                 // Determine if group changes
                 if (rowGroupId !== currentRenderedGroupId) {
                     currentRenderedGroupId = rowGroupId;
                     // Alternate background style only if it's a real group ID
                     if(rowGroupId) {
                        currentGroupStyle = currentGroupStyle === 'bg-muted/30' ? 'bg-muted/50' : 'bg-muted/30';
                     } else {
                        currentGroupStyle = 'bg-transparent'; // Reset for non-grouped items
                     } 
                 }
                 
                 // Apply style only if item belongs to a group
                 const rowStyle = rowGroupId ? currentGroupStyle : 'bg-transparent';

                 return (
                   <TableRow
                     key={row.id}
                     data-state={row.getIsSelected() && "selected"}
                     className={cn(rowStyle)} // Apply the calculated style
                   >
                     {row.getVisibleCells().map((cell) => (
                       <TableCell key={cell.id}>
                         {flexRender(cell.column.columnDef.cell, cell.getContext())}
                       </TableCell>
                     ))}
                   </TableRow>
                 )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* Add Pagination Controls */} 
      <div className="flex items-center justify-end space-x-2 py-4">
        {/* Optional: Show selected row count if using row selection */} 
        {/* <div className="flex-1 text-sm text-muted-foreground"> ... </div> */}

        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
           Page {table.getState().pagination.pageIndex + 1} of {" "}
           {table.getPageCount()}
         </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
      {/* Add Page Size Selector */} 
      <div className="flex items-center justify-end space-x-2 py-2">
         <span className="text-sm text-muted-foreground">Rows per page:</span>
         <Select
           value={`${table.getState().pagination.pageSize}`}
           onValueChange={(value) => {
             table.setPageSize(Number(value))
           }}
         >
           <SelectTrigger className="h-8 w-[70px]">
             <SelectValue placeholder={table.getState().pagination.pageSize} />
           </SelectTrigger>
           <SelectContent side="top">
             {[10, 20, 30, 40, 50].map((pageSize) => (
               <SelectItem key={pageSize} value={`${pageSize}`}>
                 {pageSize}
               </SelectItem>
             ))}
           </SelectContent>
         </Select>
      </div>
      {/* End Pagination Controls */} 
    </div>
  )
} 