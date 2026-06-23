'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBdt } from '@/lib/currency'
import { formatConfirmationNumber } from '@/lib/confirmation-number'
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration'

export type BookingPaymentSearchResult = {
  id: string
  status: string
  checkIn: string
  checkOut: string
  dueAmount: number
  confirmationNumber?: string | null
  registrationNumber?: string | null
  customer: { id: string; name: string; phone?: string | null }
  room: { id: string; roomNumber: string; type?: { name: string } }
  companyLedgerGuest?: { registrationNumber?: string | null } | null
  sourceReservationEntry?: { registrationNumber?: string | null } | null
}

type BookingPaymentSearchFieldProps = {
  selectedId: string
  selectedLabel?: string
  onSelect: (booking: BookingPaymentSearchResult) => void
  onClear: () => void
}

export function BookingPaymentSearchField({
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
}: BookingPaymentSearchFieldProps) {
  const listboxId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setHighlightedIndex(-1)
  }, [debouncedQuery])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['bookings-payment-search', debouncedQuery],
    queryFn: () =>
      api.get<{ success: boolean; data: BookingPaymentSearchResult[] }>(
        `/bookings?search=${encodeURIComponent(debouncedQuery)}&limit=15`
      ),
    enabled: open && debouncedQuery.length >= 1,
  })

  const results = data?.data ?? []
  const showList = open && debouncedQuery.length > 0
  const canNavigate = showList && results.length > 0 && !isFetching

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleSelect = (booking: BookingPaymentSearchResult) => {
    onSelect(booking)
    setSearchQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!canNavigate) {
        if (debouncedQuery.length > 0) setOpen(true)
        return
      }
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
      return
    }

    if (e.key === 'ArrowUp') {
      if (!canNavigate) return
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
      return
    }

    if (e.key === 'Enter') {
      if (!canNavigate) return
      e.preventDefault()
      const index = highlightedIndex >= 0 ? highlightedIndex : 0
      const booking = results[index]
      if (booking) handleSelect(booking)
      return
    }

    if (e.key === 'Escape') {
      if (!showList) return
      e.preventDefault()
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const formatBookingLine = (booking: BookingPaymentSearchResult) => {
    const regNo = resolveBookingRegistrationNumber(booking)
    const confNo = formatConfirmationNumber(booking)
    const parts = [
      `Room ${booking.room.roomNumber}`,
      booking.customer.name,
      regNo ? `Reg. ${regNo}` : null,
      confNo,
    ].filter(Boolean)
    return parts.join(' · ')
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <Label htmlFor={`${listboxId}-input`}>Search booking</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${listboxId}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listboxId : undefined}
          aria-activedescendant={
            canNavigate && highlightedIndex >= 0
              ? `${listboxId}-option-${highlightedIndex}`
              : undefined
          }
          aria-autocomplete="list"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Reg. no., room, guest name, conf. no…"
          className="pl-9 pr-9"
          autoComplete="off"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-amber-600" />
        )}
        {searchQuery && !isFetching && (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSearchQuery('')
              setOpen(false)
              setHighlightedIndex(-1)
            }}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          className="z-50 max-h-56 overflow-auto rounded-md border bg-card shadow-md"
          role="listbox"
        >
          {isFetching && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No bookings found</li>
          ) : (
            results.map((booking, index) => (
              <li
                key={booking.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                data-index={index}
                aria-selected={highlightedIndex === index || selectedId === booking.id}
              >
                <button
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left focus:outline-none',
                    highlightedIndex === index
                      ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                      : 'hover:bg-amber-50 focus:bg-amber-50',
                    selectedId === booking.id && highlightedIndex !== index && 'bg-amber-50/80'
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => handleSelect(booking)}
                >
                  <p className="text-sm font-medium text-foreground">{formatBookingLine(booking)}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(booking.checkIn), 'dd MMM yyyy')} –{' '}
                    {format(new Date(booking.checkOut), 'dd MMM yyyy')}
                    {' · '}
                    Due {formatBdt(booking.dueAmount ?? 0)}
                    {' · '}
                    {booking.status.replace(/_/g, ' ')}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {selectedId && selectedLabel && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
          <span className="text-emerald-900">
            Selected: <strong>{selectedLabel}</strong>
          </span>
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:text-red-700"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Live search by registration no., room number, guest name, or confirmation no.
      </p>
    </div>
  )
}
