'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '../shared/StatusBadge'
import { formatBdt } from '@/lib/currency'
import { formatGuestCompany } from '@/lib/reservation-terms'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { Eye, FileText } from 'lucide-react'

type EntryDetail = {
  id: string
  status: string
  entryStatus: string
  checkIn: string
  checkOut: string
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestAddress: string | null
  guestRegistrationNumber?: string | null
  registrationNumber?: string | null
  confirmationNumber?: string | null
  company: string | null
  companyLedger?: { id: string; name: string } | null
  totalAmount: number
  advancePayment: number
  dueAmount: number
  notes: string | null
  createdAt: string
  lineSummary: string
  totalRooms: number
  fulfilledRooms: number
  unfulfilledRooms: number
  creator: { id: string; name: string }
  lines: Array<{
    id: string
    roomTypeName: string
    roomNumber: string | null
    quantity: number
    fulfilledCount: number
    unfulfilledCount: number
  }>
  convertedBookings: Array<{
    id: string
    confirmationNumber: string | null
    roomNumber: string
  }>
}

type Props = {
  entryId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right">{value?.trim() ? value : '—'}</span>
    </div>
  )
}

export function ReservationEntryDetailsDialog({ entryId, open, onOpenChange }: Props) {
  const { formatCheckIn, formatCheckOut } = useHotelTimes()

  const { data: entryRes, isLoading } = useQuery({
    queryKey: ['reservation-entry-details', entryId],
    queryFn: () =>
      api.get<{ success: boolean; data: EntryDetail }>(`/reservation-entries/${entryId}`),
    enabled: open && !!entryId,
  })

  const entry = entryRes?.data
  const regNo = entry?.registrationNumber ?? entry?.guestRegistrationNumber

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-muted-foreground" />
            Reservation entry details
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !entry ? (
          <p className="text-sm text-red-600">Reservation entry not found.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={entry.status} className="text-xs" />
              {entry.confirmationNumber ? (
                <span className="text-xs font-mono text-muted-foreground">{entry.confirmationNumber}</span>
              ) : null}
            </div>

            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Guest</h3>
              <DetailRow label="Name" value={entry.guestName} />
              <DetailRow label="Phone" value={entry.guestPhone} />
              <DetailRow label="Email" value={entry.guestEmail} />
              <DetailRow label="Address" value={entry.guestAddress} />
              <DetailRow label="Reg. no." value={regNo} />
              <DetailRow
                label="Company"
                value={
                  entry.companyLedger?.name ??
                  (entry.company ? formatGuestCompany(entry.company) : null)
                }
              />
            </section>

            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Stay</h3>
              <DetailRow label="Check-in" value={formatCheckIn(entry.checkIn)} />
              <DetailRow label="Check-out" value={formatCheckOut(entry.checkOut)} />
              <DetailRow label="Rooms" value={entry.lineSummary} />
              <DetailRow
                label="Room count"
                value={`${entry.totalRooms} total · ${entry.fulfilledRooms} converted · ${entry.unfulfilledRooms} pending`}
              />
            </section>

            {entry.lines.length > 0 ? (
              <section className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">Room lines</h3>
                <ul className="space-y-2 text-sm">
                  {entry.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                    >
                      <span>
                        {line.roomNumber
                          ? `${line.roomTypeName} · ${line.roomNumber}`
                          : `${line.quantity}× ${line.roomTypeName}`}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {line.fulfilledCount}/{line.roomNumber ? 1 : line.quantity} done
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Payment</h3>
              <DetailRow
                label="Total"
                value={entry.totalAmount > 0 ? formatBdt(entry.totalAmount) : '—'}
              />
              <DetailRow
                label="Advance paid"
                value={entry.advancePayment > 0 ? formatBdt(entry.advancePayment) : '—'}
              />
              <DetailRow
                label="Due"
                value={entry.dueAmount > 0 ? formatBdt(entry.dueAmount) : 'Paid in full'}
              />
            </section>

            {entry.convertedBookings.length > 0 ? (
              <section className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">Converted bookings</h3>
                <ul className="space-y-1 text-sm">
                  {entry.convertedBookings.map((booking) => (
                    <li key={booking.id} className="flex justify-between gap-3">
                      <span>Room {booking.roomNumber}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {booking.confirmationNumber ?? booking.id.slice(0, 8)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {entry.notes?.trim() ? (
              <section className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">Notes</h3>
                <p className="text-sm whitespace-pre-wrap">{entry.notes.trim()}</p>
              </section>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Created {format(new Date(entry.createdAt), 'dd MMM yyyy, HH:mm')} by {entry.creator.name}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {entry ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                window.open(`/reservation-entry/${entry.id}`, '_blank', 'noopener,noreferrer')
              }
            >
              <FileText className="h-4 w-4" />
              Confirmation
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
