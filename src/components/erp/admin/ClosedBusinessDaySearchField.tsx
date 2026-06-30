'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBusinessDateDisplay } from '@/lib/business-date-format'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type ClosedBusinessDayOption = {
  id: string
  businessDate: string
  closedAt: string
}

interface ClosedBusinessDaySearchFieldProps {
  value: string
  options: ClosedBusinessDayOption[]
  loading?: boolean
  onChange: (businessDate: string) => void
}

function formatClosedDayLabel(row: ClosedBusinessDayOption): string {
  return `${formatBusinessDateDisplay(row.businessDate)} · ${format(
    parseISO(row.closedAt),
    'dd MMM yyyy · h:mm a'
  )}`
}

function closedDaySearchValue(row: ClosedBusinessDayOption): string {
  return [
    row.businessDate,
    formatBusinessDateDisplay(row.businessDate),
    format(parseISO(row.closedAt), 'dd MMM yyyy'),
    format(parseISO(row.closedAt), 'HH:mm'),
  ].join(' ')
}

export function ClosedBusinessDaySearchField({
  value,
  options,
  loading = false,
  onChange,
}: ClosedBusinessDaySearchFieldProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((row) => row.businessDate === value)
  const displayLabel = selected
    ? formatClosedDayLabel(selected)
    : loading
      ? 'Loading closed days…'
      : 'Search closed business day…'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={loading || options.length === 0}
          className="w-full min-w-[280px] justify-between font-normal h-10"
        >
          <span className="flex items-center gap-2 min-w-0">
            {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
            <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
              {displayLabel}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search by date or close time…" />
          <CommandList className="max-h-[min(360px,50vh)]">
            <CommandEmpty>No closed day found.</CommandEmpty>
            <CommandGroup>
              {options.map((row) => (
                <CommandItem
                  key={row.id}
                  value={closedDaySearchValue(row)}
                  onSelect={() => {
                    onChange(row.businessDate)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      value === row.businessDate ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="font-medium">{formatBusinessDateDisplay(row.businessDate)}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.businessDate} · closed{' '}
                      {format(parseISO(row.closedAt), 'dd MMM yyyy · h:mm a')}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
