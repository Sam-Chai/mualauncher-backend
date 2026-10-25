"use client";
import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "cn";
export function DataTable<T>({ data, columns, searchPlaceholder = "dataTable.searchRecords", empty = "dataTable.noRecords", caption, getRowId, columnClassNames, preservePagination = false }: { data: T[]; columns: ColumnDef<T>[]; searchPlaceholder?: string; empty?: string; caption?: string; getRowId?: (row: T) => string; columnClassNames?: Record<string, { header?: string; cell?: string }>; preservePagination?: boolean }) {
  "use no memo";
  const { t } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  // TanStack v8 returns functions that must not be memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({ data, columns, getRowId, state: { sorting, globalFilter, columnVisibility },
    onSortingChange: updater => { setSorting(updater); if (preservePagination) table.resetPageIndex(); }, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColumnVisibility,
    autoResetPageIndex: preservePagination ? false : undefined,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } } });
  const pageIndex = table.getState().pagination.pageIndex, lastPage = Math.max(0, table.getPageCount() - 1);
  // Polling may replace every row object. Preserve valid pages, but never leave a shortened list on an empty page.
  useEffect(() => { if (preservePagination && pageIndex > lastPage) table.setPageIndex(lastPage); }, [preservePagination, pageIndex, lastPage, table]);
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><div className="relative max-w-sm flex-1"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input value={globalFilter} onChange={event => { setGlobalFilter(event.target.value); if (preservePagination) table.resetPageIndex(); }} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder={t(searchPlaceholder)} aria-label={t(searchPlaceholder)} className="pl-9" /></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="ml-auto"><Columns3 className="size-4" /><span className="hidden sm:inline">{t("dataTable.columns")}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{table.getAllColumns().filter(column => column.getCanHide()).map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={value => column.toggleVisibility(!!value)}>{typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
    </div>
    <div className="overflow-hidden rounded-lg border"><Table>{caption && <caption className="sr-only">{t(caption)}</caption>}<TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id} className="bg-muted/50">{group.headers.map(header => <TableHead key={header.id} className={cn("whitespace-nowrap", columnClassNames?.[header.column.id]?.header)}>{header.isPlaceholder ? null : header.column.getCanSort() ? <button type="button" className="inline-flex items-center gap-2 py-3 text-left" onClick={header.column.getToggleSortingHandler()} aria-label={t("dataTable.sortColumn", { "column": String(header.column.columnDef.header) })}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowUpDown className="size-3.5" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
      <TableBody>{table.getRowModel().rows.length ? table.getRowModel().rows.map(row => <TableRow key={row.id}>{row.getVisibleCells().map(cell => <TableCell key={cell.id} className={cn("py-4", columnClassNames?.[cell.column.id]?.cell)}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="h-36 text-center text-muted-foreground">{globalFilter ? t("dataTable.noMatchingRecords") : t(empty)}</TableCell></TableRow>}</TableBody>
    </Table></div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground dark:rounded-lg dark:bg-card dark:px-3 dark:py-2"><span>{t("dataTable.recordCount", { count: table.getFilteredRowModel().rows.length })}</span><div className="flex items-center gap-3"><label className="hidden items-center gap-2 sm:flex">{t("dataTable.perPage")}<select className="rounded-md border bg-background px-2 py-1" value={table.getState().pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}>{[10, 20, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>{t("dataTable.pageSummary", { page: table.getState().pagination.pageIndex + 1, pages: Math.max(1, table.getPageCount()) })}</span><Button type="button" variant="outline" size="icon" aria-label={t("dataTable.previousPage")} disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft /></Button><Button type="button" variant="outline" size="icon" aria-label={t("dataTable.nextPage")} disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight /></Button></div></div>
  </div>;
}
