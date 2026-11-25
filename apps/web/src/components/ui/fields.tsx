import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Switch(props: SwitchPrimitive.SwitchProps) {
  return <SwitchPrimitive.Root className="switch" {...props} />;
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SelectPrimitive.Trigger className={cn('field field-auto flex items-center justify-between gap-2', className)}>
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown size={14} className="text-[var(--ink-3)]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ children }: { children: ReactNode }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-50 min-w-[180px] overflow-hidden rounded-[10px] border border-[var(--glass-border)] bg-[var(--bg-side)] p-1 shadow-[var(--glass-shadow)] backdrop-blur-xl"
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="flex cursor-pointer items-center rounded-[6px] px-2 py-1.5 text-[12.5px] text-[var(--ink-2)] outline-none data-[highlighted]:bg-[var(--panel-2)] data-[highlighted]:text-[var(--ink)]"
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function Checkbox({ checked, onCheckedChange, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string }) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="grid h-[15px] w-[15px] place-items-center rounded-[4px] border border-[var(--glass-border)] bg-[var(--field)] data-[state=checked]:border-[var(--brand)] data-[state=checked]:bg-[var(--brand)]"
    >
      <CheckboxPrimitive.Indicator>
        <Check size={11} className="text-[#241504]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
