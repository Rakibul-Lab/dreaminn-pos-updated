'use client';

import { useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  searchPlaceholder?: string;
  searchKey?: string;
  pageSize?: number;
  totalItems?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onSearch?: (value: string) => void;
  serverSidePagination?: boolean;
  emptyMessage?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  searchPlaceholder = 'Search...',
  searchKey,
  pageSize = 20,
  totalItems,
  currentPage = 1,
  onPageChange,
  onSearch,
  serverSidePagination = false,
  emptyMessage = 'No data found.',
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: serverSidePagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: serverSidePagination ? undefined : getSortedRowModel(),
    getFilteredRowModel: serverSidePagination ? undefined : getFilteredRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  const totalPages = serverSidePagination && totalItems
    ? Math.ceil(totalItems / pageSize)
    : table.getPageCount();

  const currentPageNum = serverSidePagination ? currentPage : (table.getState().pagination.pageIndex + 1);
  const totalRows = serverSidePagination ? (totalItems ?? 0) : table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-4">
      {(searchKey || onSearch) && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={onSearch ? undefined : globalFilter}
              onChange={(e) => {
                if (onSearch) {
                  onSearch(e.target.value);
                } else {
                  setGlobalFilter(e.target.value);
                }
              }}
              className="pl-9"
            />
          </div>
        </div>
      )}

      <div className="rounded-lg border max-h-[600px] overflow-auto custom-scrollbar">
        <Table className="min-w-[650px]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="font-semibold text-xs uppercase tracking-wider">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground text-center sm:text-left">
          {totalRows} record{totalRows !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-center">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (serverSidePagination && onPageChange) onPageChange(1);
              else table.setPageIndex(0);
            }}
            disabled={currentPageNum <= 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (serverSidePagination && onPageChange) onPageChange(currentPageNum - 1);
              else table.previousPage();
            }}
            disabled={currentPageNum <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            Page {currentPageNum} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (serverSidePagination && onPageChange) onPageChange(currentPageNum + 1);
              else table.nextPage();
            }}
            disabled={currentPageNum >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (serverSidePagination && onPageChange) onPageChange(totalPages);
              else table.setPageIndex(totalPages - 1);
            }}
            disabled={currentPageNum >= totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Helper to create sortable column header
export function SortableHeader({ column, title }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' }; title: string }) {
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className="-ml-4 h-8 data-[state=open]:bg-accent"
    >
      {title}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}
