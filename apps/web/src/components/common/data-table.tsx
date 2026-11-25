import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { EmptyState } from './primitives';

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  footer?: ReactNode;
  rowClassName?: (row: T) => string;
}

export function DataTable<T>({ data, columns, onRowClick, empty, footer, rowClassName }: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th key={header.id} style={{ textAlign: (header.column.columnDef.meta as { align?: 'right' })?.align ?? 'left' }}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                {empty ?? <EmptyState title="暂无数据" description="调整筛选条件或创建新条目。" />}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={[onRowClick ? 'clickable' : '', rowClassName?.(row.original) ?? ''].join(' ')}
                onClick={() => onRowClick?.(row.original)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ textAlign: (cell.column.columnDef.meta as { align?: 'right' })?.align ?? 'left' }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {footer ? <div className="flex flex-wrap gap-3 border-t border-[var(--line)] px-4 py-2 text-[11.5px] text-[var(--ink-3)]">{footer}</div> : null}
    </div>
  );
}
