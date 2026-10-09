"use client";
import { useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function DataTable<T>({ data, columns, searchPlaceholder = "搜索记录…", empty = "暂无记录", caption, getRowId }: { data: T[]; columns: ColumnDef<T>[]; searchPlaceholder?: string; empty?: string; caption?: string; getRowId?: (row: T) => string }) {
  "use no memo";
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  // TanStack v8 returns functions that must not be memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getRowId, state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } } });
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><div className="relative max-w-sm flex-1"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input value={globalFilter} onChange={event => setGlobalFilter(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="pl-9" /></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="ml-auto"><Columns3 className="size-4" /><span className="hidden sm:inline">显示列</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{table.getAllColumns().filter(column => column.getCanHide()).map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={value => column.toggleVisibility(!!value)}>{typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
    </div>
    <div className="overflow-hidden rounded-lg border"><Table>{caption && <caption className="sr-only">{caption}</caption>}<TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id} className="bg-muted/50">{group.headers.map(header => <TableHead key={header.id} className="whitespace-nowrap">{header.isPlaceholder ? null : header.column.getCanSort() ? <button type="button" className="inline-flex items-center gap-2 py-3 text-left" onClick={header.column.getToggleSortingHandler()} aria-label={`排序：${String(header.column.columnDef.header)}`}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowUpDown className="size-3.5" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
      <TableBody>{table.getRowModel().rows.length ? table.getRowModel().rows.map(row => <TableRow key={row.id}>{row.getVisibleCells().map(cell => <TableCell key={cell.id} className="py-4">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="h-36 text-center text-muted-foreground">{globalFilter ? "没有匹配的记录" : empty}</TableCell></TableRow>}</TableBody>
    </Table></div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>{table.getFilteredRowModel().rows.length} 条记录</span><div className="flex items-center gap-3"><label className="hidden items-center gap-2 sm:flex">每页<select className="rounded-md border bg-background px-2 py-1" value={table.getState().pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}>{[10, 20, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</span><Button type="button" variant="outline" size="icon" aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft /></Button><Button type="button" variant="outline" size="icon" aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight /></Button></div></div>
  </div>;
}
