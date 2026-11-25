import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List className={cn('flex gap-[18px] border-b border-[var(--line)]', className)}>
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="pb-2 pt-2 text-[12.5px] text-[var(--ink-3)] border-b-2 border-transparent -mb-px data-[state=active]:text-[var(--brand-ink)] data-[state=active]:border-[var(--brand)] data-[state=active]:font-semibold"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Content value={value} className={cn('outline-none', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
