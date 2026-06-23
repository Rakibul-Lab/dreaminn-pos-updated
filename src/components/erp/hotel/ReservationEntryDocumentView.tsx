'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  HOTEL_LOCATION,
  HOTEL_NAME,
  HOTEL_RESERVATION_FOOTER,
  HOTEL_TAGLINE,
  DEFAULT_SMOKING_STATUS,
  formatGuestCompany,
  reservationEntryDocumentTitle,
  reservationPoliciesWithTimes,
  RESERVATION_INTRO,
} from '@/lib/reservation-terms'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { countHotelStayNights, applyHotelTimeToBookingInput } from '@/lib/hotel-times'
import { formatReservationEntryConfirmationNumber, reservationEntryPdfFileName } from '@/lib/confirmation-number'
import { formatBdt } from '@/lib/currency'
import { INVOICE_SERVICE_CHARGE_PERCENT } from '@/lib/invoice-display'
import { bookingDiscountInput, computeRoomBookingTotals } from '@/lib/booking-totals'
import { formatBookingListDiscount } from '@/lib/booking-discount'
import { printReservationDocument } from '@/lib/print-reservation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { ReservationEntryDocumentData } from '@/lib/reservation-entry-document'

interface ReservationEntryDocumentViewProps {
  entryId: string
  showToolbar?: boolean
  onClose?: () => void
}

export function ReservationEntryDocumentView({
  entryId,
  showToolbar = true,
  onClose,
}: ReservationEntryDocumentViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [logoSrc, setLogoSrc] = useState('/brand-logo.png')
  const { times, formatCheckInShort, formatCheckOutShort } = useHotelTimes()

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/reservation-a4.css?v=20250623'
    document.head.appendChild(link)
    return () => link.remove()
  }, [])

  useEffect(() => {
    import('@/lib/reservation-document-html')
      .then(({ getLogoDataUrl }) => getLogoDataUrl())
      .then(setLogoSrc)
      .catch(() => {})
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['reservation-entry-document', entryId],
    queryFn: () =>
      api.get<{ success: boolean; data: ReservationEntryDocumentData }>(
        `/reservation-entries/${entryId}?view=document`
      ),
    enabled: !!entryId,
  })

  const entry = data?.data

  const handleDownloadPdf = async () => {
    if (!entry || !documentRef.current) return
    const fileName = reservationEntryPdfFileName(entry)
    setDownloadingPdf(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadReservationPdfFromElement } = await import('@/lib/reservation-pdf')
      await downloadReservationPdfFromElement(documentRef.current, fileName)
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('PDF generation failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full max-w-[210mm]" />
      </div>
    )
  }

  if (!entry) {
    return <p className="text-red-600 text-sm">Reservation entry not found.</p>
  }

  const checkInDt = applyHotelTimeToBookingInput(entry.checkIn, times.checkInTime)
  const checkOutDt = applyHotelTimeToBookingInput(entry.checkOut, times.checkOutTime)
  const nights = countHotelStayNights(checkInDt, checkOutDt)
  const policies = reservationPoliciesWithTimes(times)
  const confirmationNo = formatReservationEntryConfirmationNumber(entry)
  const servicePercent = INVOICE_SERVICE_CHARGE_PERCENT
  const chargeTotals = computeRoomBookingTotals(
    entry.totalRoomCharge,
    entry.advancePayment,
    { vatApplied: entry.vatApplied, vatPercent: entry.vatPercent },
    bookingDiscountInput(entry)
  )
  const discountDisplay = formatBookingListDiscount({
    ...entry,
    discountAmount: chargeTotals.discountAmount,
  })
  const lineCount = entry.lines.length
  const isManyRooms = lineCount >= 4 || entry.totalRooms >= 6
  const showRoomLineTable = lineCount >= 2 || entry.totalRooms > 1
  const roomSummaryText = showRoomLineTable
    ? `${entry.totalRooms} room(s) across ${lineCount} line(s)`
    : entry.lineSummary || '—'

  const densityClass =
    lineCount >= 4 || isManyRooms
      ? 'reservation-a4-sheet--density-4'
      : lineCount >= 2
        ? 'reservation-a4-sheet--density-2'
        : 'reservation-a4-sheet--density-1'

  const sheetClassName = [
    'reservation-a4-sheet reservation-a4-sheet--entry box-border shadow-md print:shadow-none',
    densityClass,
  ].join(' ')

  return (
    <div className="print-container flex flex-col items-center">
      {showToolbar && (
        <div className="mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printReservationDocument()}>
              Print
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleDownloadPdf()}
              disabled={downloadingPdf}
            >
              {downloadingPdf ? (
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

      <div
        id="reservation-document-root"
        ref={documentRef}
        className="reservation-document flex flex-col gap-6 print:gap-0"
      >
        <article
          id="reservation-document-article"
          className={`${sheetClassName} px-[14mm] pt-[12mm] pb-[16mm] print:p-0`}
        >
          <div className="rd-entry-main">
          <header className="rd-header">
            <div className="rd-header-main">
              <div className="rd-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt={HOTEL_NAME} className="rd-logo" width={52} height={52} />
                <p className="rd-hotel-name">{HOTEL_NAME}</p>
                <p className="rd-hotel-sub">{HOTEL_LOCATION}</p>
                <p className="rd-hotel-tag">{HOTEL_TAGLINE}</p>
              </div>
            </div>
            <div className="rd-doc-title-block">
              <p className="rd-doc-title">{reservationEntryDocumentTitle(entry.entryStatus)}</p>
            </div>
          </header>

          <section className="rd-block">
            <p className="rd-line">
              <span className="rd-label">Date:</span>{' '}
              <span className="rd-muted">{format(new Date(entry.createdAt), 'dd/MM/yyyy')}</span>
            </p>
            <div className="rd-row-2">
              <p>
                <span className="rd-label">Attention:</span>{' '}
                <span className="rd-muted">{entry.guestName ?? '—'}</span>
              </p>
              <p>
                <span className="rd-label">Mobile Number:</span>{' '}
                <span className="rd-muted">{entry.guestPhone ?? '—'}</span>
              </p>
            </div>
            <div className="rd-row-2">
              <p>
                <span className="rd-label">Company:</span>{' '}
                <span className="rd-muted">{formatGuestCompany(entry.company)}</span>
              </p>
              <p>
                <span className="rd-label">Registration No.:</span>{' '}
                <span className="rd-muted">{entry.registrationNumber ?? '—'}</span>
              </p>
            </div>
            {entry.guestEmail ? (
              <div className="rd-row-2">
                <p>
                  <span className="rd-label">Email:</span>{' '}
                  <span className="rd-muted">{entry.guestEmail}</span>
                </p>
              </div>
            ) : null}
            <p className="rd-intro">{RESERVATION_INTRO}</p>
          </section>

          <section className="rd-block">
            <div className="rd-details-cols">
              <div className="rd-details-col">
                <p>
                  <span className="rd-label">Name of the Guest:</span>{' '}
                  <span className="rd-muted">{entry.guestName ?? '—'}</span>
                </p>
                <p>
                  <span className="rd-label">Confirmation No.:</span>{' '}
                  <span className="rd-muted">{confirmationNo}</span>
                </p>
                <p>
                  <span className="rd-label">Status:</span>{' '}
                  <span className="rd-muted">{entry.status}</span>
                </p>
                <p>
                  <span className="rd-label">Expected Arrival:</span>{' '}
                  <span className="rd-muted">{formatCheckInShort(entry.checkIn)}</span>
                </p>
                <p>
                  <span className="rd-label">Expected Departure:</span>{' '}
                  <span className="rd-muted">{formatCheckOutShort(entry.checkOut)}</span>
                </p>
                <p>
                  <span className="rd-label">No. of Night(s):</span>{' '}
                  <span className="rd-muted">{nights}</span>
                </p>
                <p className="rd-room-summary">
                  <span className="rd-label">Room(s):</span>{' '}
                  <span className="rd-muted">{roomSummaryText}</span>
                </p>
                <p>
                  <span className="rd-label">No. of Rooms:</span>{' '}
                  <span className="rd-muted">{entry.totalRooms}</span>
                </p>
                <p>
                  <span className="rd-label">Address:</span>{' '}
                  <span className="rd-muted">{entry.guestAddress || '—'}</span>
                </p>
                <p>
                  <span className="rd-label">Remarks:</span>{' '}
                  <span className="rd-muted">{entry.notes || '—'}</span>
                </p>
              </div>
              <div className="rd-details-col">
                <p>
                  <span className="rd-label">Smoking Status:</span>{' '}
                  <span className="rd-muted">{DEFAULT_SMOKING_STATUS}</span>
                </p>
                <p>
                  <span className="rd-label">Room rent:</span>{' '}
                  <span className="rd-muted">
                    {formatBdt(entry.totalRoomCharge)} (total, {nights} night
                    {nights > 1 ? 's' : ''})
                  </span>
                </p>
                <p>
                  <span className="rd-label">Discount:</span>{' '}
                  <span className="rd-muted">
                    {discountDisplay.amount > 0
                      ? `${formatBdt(discountDisplay.amount)}${discountDisplay.label ? ` (${discountDisplay.label})` : ''}`
                      : 'N/A'}
                  </span>
                </p>
                <p>
                  <span className="rd-label">VAT:</span>{' '}
                  <span className="rd-muted">{entry.vatPercent}% included in rate</span>
                </p>
                <p>
                  <span className="rd-label">Service charge:</span>{' '}
                  <span className="rd-muted">{servicePercent}% (included in rate)</span>
                </p>
                <p>
                  <span className="rd-label">Total (incl. VAT):</span>{' '}
                  <span className="rd-muted">{formatBdt(entry.totalWithVat)}</span>
                </p>
                <p>
                  <span className="rd-label">Advance Paid:</span>{' '}
                  <span className="rd-muted">{formatBdt(entry.advancePayment)}</span>
                </p>
                <p>
                  <span className="rd-label">Balance Due:</span>{' '}
                  <span className="rd-muted">{formatBdt(entry.dueAmount)}</span>
                </p>
                <p>
                  <span className="rd-label">Form of Payment:</span>{' '}
                  <span className="rd-muted">{entry.formOfPayment || 'Not paid at booking'}</span>
                </p>
              </div>
            </div>

            {showRoomLineTable && (
              <div className="rd-guest-table-wrap">
                <p className="rd-guest-table-title">Room line details</p>
                <table className="rd-guest-table rd-room-line-table">
                  <thead>
                    <tr>
                      <th>Room type</th>
                      <th>Room no.</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line, index) => (
                      <tr key={`${line.roomTypeName}-${line.roomNumber ?? 'cat'}-${index}`}>
                        <td>{line.roomTypeName}</td>
                        <td>{line.roomNumber ?? 'To assign'}</td>
                        <td>{line.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rd-block rd-terms-block">
            <h3 className="rd-terms-title">General Terms and Conditions</h3>
            <ul className="rd-terms-list">
              {policies.map((policy) => (
                <li key={policy.title}>
                  <span className="rd-label">{policy.title}:</span> {policy.text}
                </li>
              ))}
            </ul>
          </section>
          <div className="rd-entry-fill" aria-hidden="true" />
          </div>

          <footer className="rd-document-footer">
            <div className="rd-signatures">
              <div className="rd-prepared-by">
                <p className="rd-prepared-by-title">Prepared by:</p>
                {entry.creator ? (
                  <div className="rd-prepared-by-details">
                    <p>
                      <span className="rd-label">Name:</span>{' '}
                      <span className="rd-muted">{entry.creator.name}</span>
                    </p>
                    {entry.creator.phone ? (
                      <p>
                        <span className="rd-label">Phone:</span>{' '}
                        <span className="rd-muted">{entry.creator.phone}</span>
                      </p>
                    ) : null}
                    <p>
                      <span className="rd-label">Email:</span>{' '}
                      <span className="rd-muted">{entry.creator.email}</span>
                    </p>
                  </div>
                ) : (
                  <p className="rd-muted">—</p>
                )}
              </div>
              <div className="rd-signature-col rd-signature-col--guest">
                <div className="rd-signature-line" />
                <p className="rd-signature-label">Guest:</p>
              </div>
            </div>
            <p className="rd-footer-text">{HOTEL_RESERVATION_FOOTER}</p>
          </footer>
        </article>
      </div>
    </div>
  )
}
