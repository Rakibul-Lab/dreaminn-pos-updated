'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '../shared/StatusBadge'
import { formatBdt } from '@/lib/currency'
import { formatBookingDateOnly } from '@/lib/hotel-times'
import { formatPaymentMethod, formatPaymentCategoryLabel } from '@/lib/payment-method'
import { sumBookingNetPaid } from '@/lib/booking-totals'
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration'
import { BookingPaymentSlipButton } from './BookingPaymentSlipButton'

type BookingCompanion = {
  sortOrder: number
  companionType: string
  name: string
  phone?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  email?: string | null
  address?: string | null
}

type BookingPayment = {
  id: string
  amount: number
  method: string
  paymentType: string
  categoryLabel?: string | null
  notes?: string | null
  createdAt: string
}

type BookingGuestDetail = {
  id: string
  confirmationNumber?: string | null
  registrationNumber?: string | null
  status: string
  checkIn: string
  checkOut: string
  actualCheckIn?: string | null
  adults: number
  children: number
  totalRoomCharge: number
  dueAmount: number
  vatPercent?: number
  vatAmount?: number
  totalWithVat?: number
  advancePayment: number
  company?: string | null
  notes?: string | null
  customer: {
    name: string
    phone?: string | null
    email?: string | null
    nationality?: string | null
    address?: string | null
    idType?: string | null
    idNumber?: string | null
    visaExpiryDate?: string | null
    registrationNumber?: string | null
    company?: string | null
  }
  companions?: BookingCompanion[]
  payments: BookingPayment[]
}

function formatPaymentType(type: string, categoryLabel?: string | null) {
  return formatPaymentCategoryLabel(type, categoryLabel)
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  )
}

function GuestBlock({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value?: string | null }>
}) {
  const visible = rows.filter((row) => row.value?.trim())
  if (visible.length === 0) return null
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      <div className="space-y-1.5">
        {visible.map((row) => (
          <InfoRow key={`${title}-${row.label}`} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  )
}

export function RoomBookingGuestPanel({ bookingId }: { bookingId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['booking', bookingId, 'room-guest-panel'],
    queryFn: () => api.get<{ success: boolean; data: BookingGuestDetail }>(`/bookings/${bookingId}`),
    enabled: Boolean(bookingId),
  })

  const booking = (data as { data?: BookingGuestDetail } | undefined)?.data

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (isError || !booking) {
    return <p className="text-sm text-muted-foreground">Could not load guest information.</p>
  }

  const adultCompanions =
    booking.companions?.filter((c) => c.companionType !== 'CHILD') ?? []
  const childCompanions =
    booking.companions?.filter((c) => c.companionType === 'CHILD') ?? []
  const totalPaid = sumBookingNetPaid(booking.payments)
  const stayRegistrationNumber = resolveBookingRegistrationNumber(booking)

  return (
    <div className="space-y-4 max-h-[min(60vh,520px)] overflow-y-auto custom-scrollbar pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={booking.status} />
        {booking.confirmationNumber ? (
          <span className="text-xs text-muted-foreground">Conf. {booking.confirmationNumber}</span>
        ) : null}
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Check-in</p>
          <p className="font-medium">{formatBookingDateOnly(booking.checkIn)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Check-out</p>
          <p className="font-medium">{formatBookingDateOnly(booking.checkOut)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Guests</p>
          <p className="font-medium">
            {booking.adults} adult{booking.adults === 1 ? '' : 's'}
            {booking.children > 0
              ? `, ${booking.children} child${booking.children === 1 ? '' : 'ren'}`
              : ''}
          </p>
        </div>
        {booking.actualCheckIn ? (
          <div>
            <p className="text-muted-foreground">Actual check-in</p>
            <p className="font-medium">{format(new Date(booking.actualCheckIn), 'dd MMM yyyy, HH:mm')}</p>
          </div>
        ) : null}
      </div>

      <GuestBlock
        title="Person 1"
        rows={[
          { label: 'Name', value: booking.customer.name },
          { label: 'Phone', value: booking.customer.phone },
          { label: 'Email', value: booking.customer.email },
          { label: 'Nationality', value: booking.customer.nationality },
          { label: 'ID type', value: booking.customer.idType },
          { label: 'ID number', value: booking.customer.idNumber },
          { label: 'Reg. no.', value: stayRegistrationNumber },
          { label: 'Address', value: booking.customer.address },
          { label: 'Company', value: booking.company ?? booking.customer.company },
        ]}
      />

      {adultCompanions.map((companion, index) => (
        <GuestBlock
          key={`adult-${companion.sortOrder}-${index}`}
          title={`Person ${index + 2}`}
          rows={[
            { label: 'Name', value: companion.name },
            { label: 'Phone', value: companion.phone },
            { label: 'Email', value: companion.email },
            { label: 'Nationality', value: companion.nationality },
            { label: 'ID type', value: companion.idType },
            { label: 'ID number', value: companion.idNumber },
            { label: 'Address', value: companion.address },
          ]}
        />
      ))}

      {childCompanions.map((companion, index) => (
        <GuestBlock
          key={`child-${companion.sortOrder}-${index}`}
          title={`Child ${index + 1}`}
          rows={[
            { label: 'Name', value: companion.name },
            { label: 'Nationality', value: companion.nationality },
          ]}
        />
      ))}

      {booking.notes?.trim() ? (
        <div className="rounded-lg border bg-card p-3 space-y-1">
          <p className="text-sm font-semibold">Notes</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{booking.notes}</p>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-sm font-semibold">Charges</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Room charge</span>
            <span>{formatBdt(booking.totalRoomCharge)}</span>
          </div>
          {(booking.vatAmount ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT ({booking.vatPercent ?? 15}%)</span>
              <span>{formatBdt(booking.vatAmount ?? 0)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium border-t pt-1">
            <span>Total (incl. VAT)</span>
            <span>{formatBdt(booking.totalWithVat ?? booking.totalRoomCharge)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total paid</span>
            <span className="text-emerald-700 font-medium">{formatBdt(totalPaid)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1">
            <span>Due</span>
            <span className={booking.dueAmount > 0 ? 'text-red-600' : 'text-emerald-600'}>
              {formatBdt(booking.dueAmount)}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <p className="text-sm font-semibold px-3 pt-3 pb-2">Payments</p>
        {booking.payments.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-t">
                <tr>
                  <th className="text-left p-2 font-medium">Date</th>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Method</th>
                  <th className="text-right p-2 font-medium">Amount</th>
                  <th className="text-right p-2 font-medium">Slip</th>
                </tr>
              </thead>
              <tbody>
                {[...booking.payments]
                  .sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                  )
                  .map((payment) => (
                    <tr key={payment.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        {format(new Date(payment.createdAt), 'dd MMM yyyy')}
                      </td>
                      <td className="p-2">{formatPaymentType(payment.paymentType, payment.categoryLabel)}</td>
                      <td className="p-2">{formatPaymentMethod(payment.method)}</td>
                      <td
                        className={`p-2 text-right font-medium ${
                          payment.paymentType === 'REFUND' ? 'text-red-600' : ''
                        }`}
                      >
                        {payment.paymentType === 'REFUND' ? '-' : ''}
                        {formatBdt(Math.abs(payment.amount))}
                      </td>
                      <td className="p-2 text-right">
                        <BookingPaymentSlipButton
                          paymentId={payment.id}
                          iconOnly
                          variant="ghost"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
