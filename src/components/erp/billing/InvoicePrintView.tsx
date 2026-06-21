'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  invoicePdfFileName,
  downloadInvoicePdfFromElement,
  openInvoicePdfInNewTab,
} from '@/lib/invoice-pdf'
import { toast } from 'sonner'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import {
  formatListBookingCheckIn,
  formatListBookingCheckOut,
  type BookingListDatetimeFields,
} from '@/lib/hotel-times'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'
import { useAuthStore } from '@/lib/auth-store'
import { countBookedNights } from '@/lib/booking-stay'
import { formatAmountInWords } from '@/lib/amount-in-words'
import { formatBdt } from '@/lib/currency'
import {
  INVOICE_BIN,
  INVOICE_HOTEL_ADDRESS,
  INVOICE_HOTEL_MOBILE,
  INVOICE_MUSHAK,
  INVOICE_SD_PERCENT,
  INVOICE_SERVICE_CHARGE_PERCENT,
  INVOICE_VAT_PERCENT,
  INVOICE_ZERO_DISCOUNT_DISPLAY,
  buildInvoicePaymentSummary,
  sumPaymentsByMethod,
  formatDiscountLabel,
  formatDiscountColumnHeading,
  resolveInvoiceDiscountMeta,
  resolveInvoiceHotelServicePercent,
  resolveInvoiceRoomVatAmount,
  sumChargeRowAmounts,
  type InvoiceChargeDisplayRow,
} from '@/lib/invoice-display'
import {
  buildHotelInvoiceChargeRows,
  buildRestaurantInvoiceChargeRows,
} from '@/lib/invoice-charge-rows'
import { formatInvoiceNumberDisplay } from '@/lib/invoice-number'
import { INVOICE_GUEST_AGREEMENT } from '@/lib/reservation-terms'
import { formatBookingStatusFilterLabel } from '@/lib/booking-date-filter'

export interface InvoicePrintData {
  id: string
  invoiceNumber: string
  roomCharges: number
  foodCharges: number
  extraCharges: number
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  dueAmount: number
  declaredVatPercent?: number
  declaredServiceChargePercent?: number
  invoiceNotes?: string[]
  createdAt: string
  payments?: Array<{
    id: string
    amount: number
    method: string
    paymentType: string
    createdAt: string
  }>
  booking: {
    id: string
    checkIn: string
    checkOut: string
    actualCheckIn?: string | null
    actualCheckOut?: string | null
    adults?: number
    children?: number
    status?: string
    company?: string | null
    notes?: string | null
    isCorporateGuest?: boolean
    discountEnabled?: boolean
    discountType?: string | null
    discountValue?: number
    serviceChargePercent?: number | null
    customer: {
      name: string
      phone: string
      email?: string | null
      address?: string | null
      nationality?: string | null
      idType?: string | null
      idNumber?: string | null
      registrationNumber?: string | null
      company?: string | null
      designation?: string | null
    }
    companyLedger?: {
      name: string
      contactPerson?: string | null
      phone?: string | null
      email?: string | null
      address?: string | null
    } | null
    companyLedgerGuest?: {
      guestName: string
      phone?: string | null
      email?: string | null
      nationality?: string | null
      registrationNumber?: string | null
      address?: string | null
      idType?: string | null
      idNumber?: string | null
    } | null
    creator?: { name: string } | null
    companions?: Array<{
      name: string
      companionType: string
      company?: string | null
      designation?: string | null
      phone?: string | null
      address?: string | null
      nationality?: string | null
      idType?: string | null
      idNumber?: string | null
    }>
    room: { roomNumber: string; totalPrice?: number; type: { name: string } }
    restaurantOrders?: Array<{
      id: string
      orderNumber: string
      subtotal: number
      discount: number
      vatPercent: number
      vatAmount: number
      totalAmount: number
      createdAt: string
    }>
  }
  items: Array<{
    id: string
    itemType?: string
    referenceId?: string | null
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
}

type InvoiceChargeRow = InvoiceChargeDisplayRow

function splitDisplayDateTime(value: string): { date: string; time: string } {
  const separator = ' · '
  const idx = value.indexOf(separator)
  if (idx === -1) return { date: value, time: '' }
  return { date: value.slice(0, idx), time: value.slice(idx + separator.length) }
}

function chargeDateTime(value: string | Date): { date: string; time: string } {
  const d = new Date(value)
  return splitDisplayDateTime(format(d, 'MMM dd, yyyy · h:mm a'))
}

interface InvoicePrintViewProps {
  invoiceId: string
  showToolbar?: boolean
  title?: string
  successBanner?: string
  onClose?: () => void
}

export function InvoicePrintView({
  invoiceId,
  showToolbar = true,
  title = 'Invoice',
  successBanner,
  onClose,
}: InvoicePrintViewProps) {
  const documentRef = useRef<HTMLElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { times } = useHotelTimes()
  const user = useAuthStore((s) => s.user)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['print-invoice', invoiceId],
    queryFn: () => api.get<{ success: boolean; data: InvoicePrintData }>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  })

  const invoice = data?.data
  const roomBill = invoice?.roomCharges || 0
  const restaurantOrders = invoice?.booking?.restaurantOrders || []
  const restaurantSubtotal = restaurantOrders.reduce((sum, o) => sum + o.subtotal, 0)
  const restaurantDiscount = restaurantOrders.reduce((sum, o) => sum + o.discount, 0)
  const restaurantBill = Math.max(0, restaurantSubtotal - restaurantDiscount)
  const extraBill = invoice?.extraCharges || 0
  const restaurantVat = restaurantOrders.reduce((sum, o) => sum + o.vatAmount, 0)
  const roomVat = invoice
    ? resolveInvoiceRoomVatAmount({
        invoiceVatAmount: invoice.vatAmount || 0,
        restaurantVat,
        roomCharges: roomBill,
        discount: invoice.discount || 0,
        booking: invoice.booking,
      })
    : 0
  const hotelVatPercent = invoice?.declaredVatPercent ?? INVOICE_VAT_PERCENT
  const hotelServiceChargePercent =
    invoice?.declaredServiceChargePercent ??
    resolveInvoiceHotelServicePercent(invoice?.booking)
  const vatRates = Array.from(new Set(restaurantOrders.map((o) => Number(o.vatPercent || 0))))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  const handleDownloadPdf = async () => {
    if (!invoice || !documentRef.current) return
    setPdfBusy(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      await downloadInvoicePdfFromElement(
        documentRef.current,
        invoicePdfFileName(formatInvoiceNumberDisplay(invoice.invoiceNumber))
      )
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('Invoice PDF failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setPdfBusy(false)
    }
  }

  const handlePrintPdf = async () => {
    if (!invoice || !documentRef.current) return
    setPdfBusy(true)
    const toastId = toast.loading('Opening invoice for print…')
    try {
      const fileName = invoicePdfFileName(formatInvoiceNumberDisplay(invoice.invoiceNumber))
      const opened = await openInvoicePdfInNewTab(documentRef.current, fileName)
      if (!opened) {
        toast.error('Pop-up blocked. Allow pop-ups for this site, or use Download PDF.', {
          id: toastId,
        })
        return
      }
      toast.success('Invoice opened in a new tab — print from the browser PDF viewer', {
        id: toastId,
      })
    } catch (err) {
      console.error('Invoice print preview failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to open print preview: ${msg}`, { id: toastId })
    } finally {
      setPdfBusy(false)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading invoice...</div>
  }

  if (isError) {
    const message = error instanceof Error ? error.message : 'Failed to load invoice'
    return <div className="p-8 text-sm text-red-600">{message}</div>
  }

  if (!invoice) {
    return <div className="p-8 text-sm text-red-600">Invoice not found.</div>
  }

  const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice.invoiceNumber)
  const companyName =
    invoice.booking.companyLedger?.name ||
    invoice.booking.company ||
    invoice.booking.customer.company ||
    null
  const isCorporateGuest = invoice.booking.isCorporateGuest === true
  const adultCompanions =
    invoice.booking.companions?.filter((c) => c.companionType !== 'CHILD') ?? []
  const invoiceGuestRows = isCorporateGuest
    ? [
        {
          label: 'Person 1',
          name: invoice.booking.customer.name,
          phone: invoice.booking.customer.phone,
        },
        ...adultCompanions.map((companion, index) => ({
          label: `Person ${index + 2}`,
          name: companion.name,
          phone: companion.phone,
        })),
      ]
    : [
        {
          label: 'Guest 1',
          name: invoice.booking.customer.name,
          phone: invoice.booking.customer.phone,
        },
        ...adultCompanions.map((companion, index) => ({
          label: `Guest ${index + 2}`,
          name: companion.name,
          phone: companion.phone,
        })),
      ]
  const guestCount = (invoice.booking.adults ?? 1) + (invoice.booking.children ?? 0)
  const bookedNights = countBookedNights(
    new Date(invoice.booking.checkIn),
    new Date(invoice.booking.checkOut)
  )
  const roomRate =
    invoice.booking.room.totalPrice ??
    (bookedNights > 0 ? Math.round(roomBill / bookedNights) : roomBill)
  const bookingStatus = invoice.booking.status
    ? formatBookingStatusFilterLabel(invoice.booking.status)
    : '—'

  const bookingDatetimeFields: BookingListDatetimeFields = {
    checkIn: invoice.booking.checkIn,
    checkOut: invoice.booking.checkOut,
    actualCheckIn: invoice.booking.actualCheckIn,
    actualCheckOut: invoice.booking.actualCheckOut,
    status: invoice.booking.status ?? '',
  }
  const displayCheckIn = formatListBookingCheckIn(bookingDatetimeFields, times)
  const displayCheckOut = formatListBookingCheckOut(bookingDatetimeFields, times)

  const orderDateTimeByRef = new Map(
    restaurantOrders.map((o) => [o.id, chargeDateTime(o.createdAt)])
  )
  const orderVatPercentByLabel = new Map(
    restaurantOrders.map((o) => {
      const label = o.orderNumber ? `#${o.orderNumber}` : o.id.slice(-6)
      return [label, Number(o.vatPercent || 0)]
    })
  )
  const defaultRestaurantVatPercent =
    vatRates.length === 1 ? vatRates[0] : vatRates.length > 0 ? vatRates[0] : INVOICE_VAT_PERCENT
  const invoiceDateTime = chargeDateTime(invoice.createdAt)
  const stayChargeDateTime = splitDisplayDateTime(displayCheckIn)
  const lineItems = invoice.items ?? []
  const discountMeta = resolveInvoiceDiscountMeta(invoice.booking)

  const resolveItemDateTime = (type: string, referenceId?: string | null) => {
    if (type === 'room_charge' || type === 'extra_service') return stayChargeDateTime
    if (referenceId && orderDateTimeByRef.has(referenceId)) {
      return orderDateTimeByRef.get(referenceId)!
    }
    const orderMatch = restaurantOrders.find((o) => o.id === referenceId)
    if (orderMatch) return chargeDateTime(orderMatch.createdAt)
    return invoiceDateTime
  }

  const resolveOrderVatPercent = (description: string): number | null => {
    const match = description.match(/Order (#?\S+)\)/)
    if (match && orderVatPercentByLabel.has(match[1])) {
      const percent = orderVatPercentByLabel.get(match[1])!
      return percent > 0 ? percent : null
    }
    return defaultRestaurantVatPercent
  }

  const rowContext = {
    lineItems,
    roomBill,
    extraBill,
    roomVat,
    hotelVatPercent,
    hotelServiceChargePercent,
    restaurantBill,
    restaurantVat,
    restaurantOrders,
    bookedNights,
    nightlyRate: roomRate,
    hotelDiscountAmount: invoice.discount,
    hotelDiscountLabel: formatDiscountLabel(
      discountMeta.type,
      discountMeta.value,
      invoice.discount
    ),
    hotelDiscountEnabled: discountMeta.enabled,
    hotelDiscountType: discountMeta.type,
    hotelDiscountValue: discountMeta.value,
    roomNumber: invoice.booking.room.roomNumber,
    roomTypeName: invoice.booking.room.type.name,
    stayDateTime: stayChargeDateTime,
    invoiceDateTime,
    resolveItemDateTime,
    resolveOrderVatPercent,
    defaultRestaurantVatPercent,
  }

  const hotelRows = buildHotelInvoiceChargeRows(rowContext)
  const restaurantRows = buildRestaurantInvoiceChargeRows(rowContext)
  const hotelPartTotal = sumChargeRowAmounts(hotelRows)
  const restaurantPartTotal = sumChargeRowAmounts(restaurantRows)
  const combinedTotal = hotelPartTotal + restaurantPartTotal
  const tableDiscountTotal = [...hotelRows, ...restaurantRows].reduce(
    (sum, row) => sum + Math.max(0, row.discountAmount),
    0
  )
  const invoiceDiscount = tableDiscountTotal > 0 ? tableDiscountTotal : invoice.discount
  const paymentSummary = buildInvoicePaymentSummary({
    payments: invoice.payments ?? [],
    paidAmount: invoice.paidAmount,
    totalAmount: invoice.totalAmount,
    dueAmount: invoice.dueAmount,
  })
  const cardPaymentAmount = sumPaymentsByMethod(invoice.payments ?? [], 'CARD')
  const totalInWords = formatAmountInWords(invoice.totalAmount)
  const invoiceNotes = invoice.invoiceNotes ?? []
  const hotelDiscountColumnHeading = formatDiscountColumnHeading(
    discountMeta.type,
    discountMeta.value,
    invoice.discount > 0 || hotelRows.some((row) => row.discountAmount > 0)
  )

  const renderChargeTable = (
    title: string,
    rows: InvoiceChargeRow[],
    sectionTotal: number,
    vatPercentLabel: number,
    servicePercentLabel: number,
    discountColumnHeading = 'Discount'
  ) => (
    <div className="invoice-charge-section rounded-lg border border-border p-4">
      <p className="text-[8pt] font-semibold uppercase tracking-wide mb-2">
        {title}
      </p>
      <table className="invoice-charge-table w-full text-[8pt]">
        <colgroup>
          <col className="invoice-charge-date" />
          <col className="invoice-charge-category" />
          <col className="invoice-charge-num" />
          <col className="invoice-charge-discount" />
          <col className="invoice-charge-sd" />
          <col className="invoice-charge-num" />
          <col className="invoice-charge-num" />
          <col className="invoice-charge-amount" />
        </colgroup>
        <thead>
          <tr className="border-b text-left">
            <th className="invoice-charge-date py-2 pr-1 font-semibold">Date</th>
            <th className="invoice-charge-category py-2 pr-1 font-semibold">Category</th>
            <th className="invoice-charge-num py-2 pr-1 font-semibold text-right">
              Room Rent
            </th>
            <th className="invoice-charge-discount py-2 px-1 font-semibold text-right">
              {discountColumnHeading}
            </th>
            <th className="invoice-charge-sd py-2 px-1 font-semibold text-right">
              SD{INVOICE_SD_PERCENT > 0 ? ` (${INVOICE_SD_PERCENT}%)` : ''}
            </th>
            <th className="invoice-charge-num py-2 pr-1 font-semibold text-right">
              VAT ({vatPercentLabel}%)
            </th>
            <th className="invoice-charge-num py-2 pr-1 font-semibold text-right">
              Service ({servicePercentLabel}%)
            </th>
            <th className="invoice-charge-amount py-2 px-1 font-semibold text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-border">
              <td colSpan={8} className="py-2 text-center">
                No charges
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="invoice-charge-row border-b border-border">
                <td className="invoice-charge-date py-2 pr-1 align-top">
                  <span className="block whitespace-nowrap">{row.date}</span>
                  {row.time ? (
                    <span className="block text-[7pt] whitespace-nowrap">{row.time}</span>
                  ) : null}
                </td>
                <td className="invoice-charge-category py-2 pr-1 align-top break-words">
                  <span className="font-medium">{row.category}</span>
                  {row.description && row.description !== row.category ? (
                    <span className="block text-[7pt]">{row.description}</span>
                  ) : null}
                </td>
                <td className="invoice-charge-num py-2 pr-1 text-right whitespace-nowrap">
                  {row.roomRent > 0 ? formatBdt(row.roomRent) : '—'}
                </td>
                <td className="invoice-charge-discount py-2 px-1 text-right whitespace-nowrap">
                  {row.discountAmount > 0 ? formatBdt(row.discountAmount) : INVOICE_ZERO_DISCOUNT_DISPLAY}
                </td>
                <td className="invoice-charge-sd py-2 px-1 text-right whitespace-nowrap">
                  {row.sdAmount > 0 ? formatBdt(row.sdAmount) : INVOICE_ZERO_DISCOUNT_DISPLAY}
                </td>
                <td className="invoice-charge-num py-2 pr-1 text-right whitespace-nowrap">
                  {row.vatAmount > 0 ? formatBdt(row.vatAmount) : '—'}
                </td>
                <td className="invoice-charge-num py-2 pr-1 text-right whitespace-nowrap">
                  {row.serviceChargeAmount > 0 ? formatBdt(row.serviceChargeAmount) : '—'}
                </td>
                <td className="invoice-charge-amount py-2 px-1 text-right font-medium whitespace-nowrap">
                  {row.amount < 0 ? '-' : ''}
                  {formatBdt(Math.abs(row.amount))}
                </td>
              </tr>
            ))
          )}
          <tr className="invoice-total-row border-t border-border">
            <td colSpan={6} className="py-2" />
            <td className="invoice-charge-num py-2 px-1 text-right font-semibold whitespace-nowrap">
              Total
            </td>
            <td className="invoice-charge-amount py-2 px-1 text-right font-semibold whitespace-nowrap">
              {formatBdt(sectionTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="invoice-print-root min-h-screen flex flex-col bg-background print:min-h-0 print:h-auto print:block">
      <div className="flex-1 p-6 print:p-0 print:m-0 print:min-h-0 print:h-auto print:bg-white">
      {showToolbar && (
        <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {successBanner && (
              <p className="mt-1 text-sm text-emerald-700">{successBanner}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void handlePrintPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                'Print'
              )}
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleDownloadPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                'Download PDF'
              )}
            </Button>
            {onClose && (
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      )}

      <main
        ref={documentRef}
        className="print-container invoice-print-page mx-auto max-w-4xl rounded-xl border border-border bg-card p-6 text-black print:border-0 print:bg-white print:p-0 print:shadow-none print:text-black"
      >
        <div className="invoice-a4-sheet text-black font-bold text-[9pt] print:border-0">
          <div className="invoice-pdf-header mb-4 flex items-start justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-background print:bg-white">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-bold">RRP Dream Inn</p>
                <p className="invoice-hotel-address text-black text-[7pt] whitespace-nowrap leading-snug">
                  {INVOICE_HOTEL_ADDRESS}
                </p>
                <p className="invoice-hotel-mobile text-black text-[7.5pt]">
                  Mobile: {INVOICE_HOTEL_MOBILE}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-6 sm:gap-10 text-right">
              <div className="space-y-0.5">
                <p className="text-[9pt] font-semibold whitespace-nowrap">
                  Invoice: <span className="font-mono">{displayInvoiceNumber}</span>
                </p>
                <p className="text-[8pt] whitespace-nowrap">
                  Date: {format(new Date(invoice.createdAt), 'dd/MM/yyyy')}
                </p>
              </div>
              <div className="space-y-0.5 border-l border-border pl-6 sm:pl-10">
                <p className="text-[8pt]">{INVOICE_MUSHAK}</p>
                <p className="text-[8pt]">BIN: {INVOICE_BIN}</p>
              </div>
            </div>
          </div>

          <div
            className="invoice-pdf-continuation-header hidden mb-3 flex items-center justify-between border-b border-border pb-2 text-[8pt]"
            aria-hidden
          >
            <p className="font-bold">RRP Dream Inn (continued)</p>
            <p className="font-mono">Invoice: {displayInvoiceNumber}</p>
          </div>

          <div className="invoice-pdf-body">
          <div className="invoice-guest-block mb-4 grid grid-cols-1 gap-3 text-[8.5pt] md:grid-cols-2 md:items-start">
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3 space-y-2">
                {invoiceGuestRows.map((guest, index) => (
                  <div
                    key={`${guest.label}-${index}`}
                    className={index > 0 ? 'border-t border-border pt-2' : ''}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 items-start">
                      <p className="min-w-0">
                        <span>{guest.label}:</span>{' '}
                        <span className="font-semibold">{guest.name || '—'}</span>
                      </p>
                      <p className="shrink-0 whitespace-nowrap text-right">
                        <span>Phone:</span> {guest.phone || '—'}
                      </p>
                    </div>
                  </div>
                ))}
                {(invoice.booking.children ?? 0) > 0 ? (
                  <p className="border-t border-border pt-2 text-[8pt]">
                    Children on record: {invoice.booking.children} (count only)
                  </p>
                ) : null}
              </div>

              {companyName ? (
                <div className="rounded-lg border border-border p-3">
                  <p>
                    <span>Company:</span>{' '}
                    <span className="font-semibold">{companyName}</span>
                  </p>
                </div>
              ) : null}

              <div className="rounded-lg border border-border p-3">
                <p>
                  <span>Status:</span>{' '}
                  <span className="font-semibold">{bookingStatus}</span>
                </p>
              </div>

              {invoiceNotes.length > 0 ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="font-semibold mb-1.5">Notes</p>
                  <ul className="space-y-1 list-disc pl-4">
                    {invoiceNotes.map((note, index) => (
                      <li key={`${index}-${note.slice(0, 24)}`} className="whitespace-pre-wrap">
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-border p-3">
              <table className="w-full text-[8.5pt]">
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3 w-[40%]">Room</td>
                    <td className="py-2 font-medium">
                      {invoice.booking.room.roomNumber} · {invoice.booking.room.type.name}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Room rate</td>
                    <td className="py-2 font-medium">{formatBdt(roomRate)}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Guest</td>
                    <td className="py-2 font-medium">
                      {guestCount} guest{guestCount !== 1 ? 's' : ''}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Nights</td>
                    <td className="py-2 font-medium">{bookedNights}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Check-in</td>
                    <td className="py-2 font-medium">{displayCheckIn}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3">Check-out</td>
                    <td className="py-2 font-medium">{displayCheckOut}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-4 space-y-3 text-[8.5pt]">
            {renderChargeTable(
              'Hotel',
              hotelRows,
              hotelPartTotal,
              hotelVatPercent,
              hotelServiceChargePercent,
              hotelDiscountColumnHeading
            )}
            {renderChargeTable(
              'Restaurant',
              restaurantRows,
              restaurantPartTotal,
              defaultRestaurantVatPercent ?? INVOICE_VAT_PERCENT,
              INVOICE_SERVICE_CHARGE_PERCENT
            )}
          </div>

          <div className="invoice-pdf-summary w-full text-[8.5pt]">
            <div className="rounded border border-border p-2.5">
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Combined Total</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatBdt(combinedTotal)}
                    </td>
                  </tr>
                  {invoiceDiscount > 0 ? (
                    <tr>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {formatDiscountColumnHeading(discountMeta.type, discountMeta.value, true)}
                      </td>
                      <td className="py-1 text-right whitespace-nowrap">
                        -{formatBdt(invoiceDiscount)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <table className="w-full border-t border-border mt-2">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Guest Paid</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatBdt(paymentSummary.totalPaid)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Card Payment</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {cardPaymentAmount > 0
                        ? formatBdt(cardPaymentAmount)
                        : INVOICE_ZERO_DISCOUNT_DISPLAY}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 font-bold text-[9pt] whitespace-nowrap">
                      Balance Due
                    </td>
                    <td className="py-1 text-right font-bold text-[9pt] whitespace-nowrap">
                      {formatBdt(paymentSummary.due)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <p className="text-[8pt] border-t border-border pt-2 mt-2 italic">
                <span className="font-medium not-italic">In words: </span>
                {totalInWords}
              </p>
            </div>
          </div>

          <div className="invoice-print-footer mt-6 text-[8pt] space-y-3">
            <p className="text-center">
              Thank you for choosing RRP Dream Inn. We look forward to welcoming you again.
            </p>

            <p className="text-center text-[8pt] leading-relaxed">{INVOICE_GUEST_AGREEMENT}</p>

            <div className="invoice-signatures grid grid-cols-2 gap-8 pt-2">
              <div className="invoice-signature-col">
                <div className="invoice-signature-line" />
                <p className="invoice-signature-label">Authorized Signature</p>
              </div>
              <div className="invoice-signature-col">
                <div className="invoice-signature-line" />
                <p className="invoice-signature-label">Guest Signature</p>
              </div>
            </div>

            <p className="invoice-generated-by font-normal text-center pt-2">
              Generated by {user?.name || invoice.booking.creator?.name || 'Staff'} ·{' '}
              {format(new Date(), 'dd MMM yyyy, h:mm a')}
            </p>
          </div>
          </div>
        </div>
      </main>
      </div>
      <AppDevelopedByFooter printHidden />
    </div>
  )
}
