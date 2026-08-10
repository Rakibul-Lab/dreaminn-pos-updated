'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Download, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { formatAmountInWords } from '@/lib/amount-in-words'
import { formatBdt } from '@/lib/currency'
import {
  INVOICE_BIN,
  INVOICE_HOTEL_ADDRESS_LINES,
  INVOICE_HOTEL_MOBILE,
  INVOICE_MUSHAK,
} from '@/lib/invoice-display'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type ReceiptData = {
  hotelName: string
  hotelLocation: string
  slipNumber: string
  paymentId: string
  amount: number
  isRefund: boolean
  methodLabel: string
  paymentTypeLabel: string
  reference: string | null
  accountDetail: string | null
  notes: string | null
  paidAt: string
  businessDate: string | null
  receivedBy: string | null
  guestName: string
  guestPhone: string | null
  roomNumber: string | null
  confirmationNumber: string
  registrationNumber: string | null
  stayTotal?: number | null
  totalPaid?: number | null
  balanceDue?: number | null
  hasAccountSummary?: boolean
  invoiceNumber: string | null
  checkIn?: string
  checkOut?: string
}

interface BookingPaymentThermalReceiptViewProps {
  paymentId: string
  autoPrint?: boolean
}

export function BookingPaymentThermalReceiptView({
  paymentId,
  autoPrint = false,
}: BookingPaymentThermalReceiptViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['booking-payment-receipt', paymentId],
    queryFn: () =>
      api.get<{ success: boolean; data: ReceiptData }>(`/payments/${paymentId}/receipt`),
    enabled: !!paymentId,
  })

  const receipt = data?.data

  useEffect(() => {
    if (!autoPrint || !receipt) return
    const timer = window.setTimeout(() => window.print(), 500)
    return () => window.clearTimeout(timer)
  }, [autoPrint, receipt])

  const handlePrint = () => window.print()

  const handleDownloadPdf = async () => {
    if (!documentRef.current || !receipt) return
    setDownloading(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadInvoicePdfFromElement } = await import('@/lib/invoice-pdf')
      await downloadInvoicePdfFromElement(
        documentRef.current,
        `payment-slip-${receipt.slipNumber}.pdf`
      )
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF download failed', { id: toastId })
    } finally {
      setDownloading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (isError || !receipt) {
    const message =
      error instanceof Error ? error.message : 'Could not load payment slip.'
    return (
      <div className="mx-auto max-w-lg space-y-2 p-8 text-center text-sm">
        <p className="font-medium text-red-600">{message}</p>
        <p className="text-xs text-muted-foreground">
          Confirm you are logged in and the payment belongs to a hotel booking.
        </p>
      </div>
    )
  }

  const documentTitle = receipt.isRefund ? 'Refund Receipt' : 'Payment Receipt'
  const amountLabel = receipt.isRefund ? 'Amount refunded' : 'Amount received'
  const signedAmount = receipt.isRefund ? -Math.abs(receipt.amount) : receipt.amount

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
        <Button type="button" variant="outline" onClick={handleDownloadPdf} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download PDF
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.close()}>
          Close tab
        </Button>
      </div>

      <div
        ref={documentRef}
        className="print-container invoice-print-page mx-auto max-w-4xl rounded-xl border border-border bg-card p-6 text-black shadow-sm print:border-0 print:bg-white print:p-0 print:shadow-none"
      >
        <div className="invoice-a4-sheet text-black font-bold text-[9pt] print:border-0">
          <div className="invoice-pdf-header invoice-pdf-header-grid mb-4 grid grid-cols-1 items-start gap-4 border-b border-border pb-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]">
            <div className="invoice-pdf-header-brand flex min-w-0 items-start gap-2">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-background print:bg-white">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="invoice-pdf-header-brand-text min-w-0 max-w-full">
                <p className="text-sm font-bold leading-tight">{receipt.hotelName}</p>
                {INVOICE_HOTEL_ADDRESS_LINES.map((line) => (
                  <p
                    key={line}
                    className="invoice-hotel-address text-black text-[7pt] leading-snug whitespace-nowrap"
                  >
                    {line}
                  </p>
                ))}
                <p className="invoice-hotel-mobile text-black text-[7.5pt] leading-snug">
                  Mobile: {INVOICE_HOTEL_MOBILE}
                </p>
              </div>
            </div>

            <div className="invoice-pdf-header-invoice flex justify-center">
              <div className="space-y-0.5 text-left">
                <p className="text-[9pt] font-semibold leading-tight whitespace-nowrap">
                  {documentTitle}:{' '}
                  <span className="font-mono">{receipt.slipNumber}</span>
                </p>
                <p className="text-[8pt] leading-tight whitespace-nowrap">
                  Date: {format(new Date(receipt.paidAt), 'dd/MM/yyyy')}
                </p>
                <p className="text-[8pt] leading-tight whitespace-nowrap">
                  Time: {format(new Date(receipt.paidAt), 'hh:mm a')}
                </p>
              </div>
            </div>

            <div className="invoice-tax-meta space-y-0.5 justify-self-start text-left md:justify-self-end md:text-right">
              <p className="text-[8pt] leading-tight whitespace-nowrap">{INVOICE_MUSHAK}</p>
              <p className="text-[8pt] leading-tight whitespace-nowrap">BIN: {INVOICE_BIN}</p>
            </div>
          </div>

          <div className="invoice-pdf-body space-y-4">
            <div className="grid gap-4 border-b pb-4 text-[8.5pt] md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[8pt] uppercase tracking-wide text-neutral-600">Guest details</p>
                <p>
                  <span className="text-neutral-600">Guest:</span>{' '}
                  <span className="font-semibold">{receipt.guestName}</span>
                </p>
                {receipt.guestPhone ? (
                  <p>
                    <span className="text-neutral-600">Phone:</span> {receipt.guestPhone}
                  </p>
                ) : null}
                {receipt.roomNumber ? (
                  <p>
                    <span className="text-neutral-600">Room:</span> {receipt.roomNumber}
                  </p>
                ) : null}
                {receipt.registrationNumber ? (
                  <p>
                    <span className="text-neutral-600">Reg. No:</span>{' '}
                    {receipt.registrationNumber}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5 md:text-right">
                <p className="text-[8pt] uppercase tracking-wide text-neutral-600 md:text-right">
                  Booking reference
                </p>
                <p>
                  <span className="text-neutral-600">Conf. No:</span>{' '}
                  <span className="font-mono">{receipt.confirmationNumber}</span>
                </p>
                {receipt.invoiceNumber ? (
                  <p>
                    <span className="text-neutral-600">Invoice:</span>{' '}
                    <span className="font-mono">{receipt.invoiceNumber}</span>
                  </p>
                ) : null}
                {receipt.businessDate ? (
                  <p>
                    <span className="text-neutral-600">Business day:</span> {receipt.businessDate}
                  </p>
                ) : null}
                {receipt.checkIn ? (
                  <p>
                    <span className="text-neutral-600">Check-in:</span>{' '}
                    {format(new Date(receipt.checkIn), 'dd MMM yyyy')}
                  </p>
                ) : null}
                {receipt.checkOut ? (
                  <p>
                    <span className="text-neutral-600">Check-out:</span>{' '}
                    {format(new Date(receipt.checkOut), 'dd MMM yyyy')}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="invoice-pdf-summary w-full text-[8.5pt]">
              <div className="rounded border border-border p-3">
                <p className="mb-2 text-[8pt] uppercase tracking-wide">Payment details</p>
                <table className="w-full">
                  <tbody>
                    <tr>
                      <td className="py-1.5 pr-2 whitespace-nowrap">Payment type</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {receipt.paymentTypeLabel}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 whitespace-nowrap">Payment method</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {receipt.methodLabel}
                      </td>
                    </tr>
                    {receipt.reference ? (
                      <tr>
                        <td className="py-1.5 pr-2 whitespace-nowrap">Reference</td>
                        <td className="py-1.5 text-right">{receipt.reference}</td>
                      </tr>
                    ) : null}
                    {receipt.accountDetail ? (
                      <tr>
                        <td className="py-1.5 pr-2 whitespace-nowrap">Account</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {receipt.accountDetail}
                        </td>
                      </tr>
                    ) : null}
                    {receipt.receivedBy ? (
                      <tr>
                        <td className="py-1.5 pr-2 whitespace-nowrap">Received by</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {receipt.receivedBy}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>

                <table className="mt-2 w-full border-t border-border">
                  <tbody>
                    <tr>
                      <td className="py-2 pr-2 text-[10pt] font-bold whitespace-nowrap">
                        {amountLabel}
                      </td>
                      <td className="py-2 text-right text-[10pt] font-bold whitespace-nowrap">
                        {formatBdt(signedAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="mt-2 border-t border-border pt-2 text-[8pt] italic">
                  <span className="font-medium not-italic">In words: </span>
                  {formatAmountInWords(Math.abs(receipt.amount))}
                </p>

                {receipt.notes?.trim() ? (
                  <p className="mt-2 border-t border-border pt-2 text-[8pt]">
                    <span className="font-medium">Notes: </span>
                    <span className="font-normal italic">{receipt.notes}</span>
                  </p>
                ) : null}
              </div>
            </div>

            {receipt.hasAccountSummary && (
              <div className="invoice-pdf-summary w-full text-[8.5pt]">
                <div className="rounded border border-border p-3">
                  <p className="mb-2 text-[8pt] uppercase tracking-wide">Account summary</p>
                  <table className="w-full">
                    <tbody>
                      {receipt.stayTotal != null && (
                        <tr>
                          <td className="py-1.5 pr-2 whitespace-nowrap">Stay total</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {formatBdt(receipt.stayTotal)}
                          </td>
                        </tr>
                      )}
                      {receipt.totalPaid != null && (
                        <tr>
                          <td className="py-1.5 pr-2 whitespace-nowrap">Total paid</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {formatBdt(receipt.totalPaid)}
                          </td>
                        </tr>
                      )}
                      {receipt.balanceDue != null && (
                        <tr>
                          <td className="py-1.5 pr-2 text-[9pt] font-bold whitespace-nowrap">
                            Balance due
                          </td>
                          <td className="py-1.5 text-right text-[9pt] font-bold whitespace-nowrap">
                            {formatBdt(receipt.balanceDue)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="invoice-print-footer mt-8 space-y-4 text-[8pt]">
              <p className="text-center">
                {receipt.isRefund
                  ? `Refund processed. Thank you for choosing ${receipt.hotelName}.`
                  : `Thank you for your payment. We look forward to welcoming you at ${receipt.hotelName}.`}
              </p>

              <div className="invoice-signatures grid grid-cols-2 gap-8 pt-4">
                <div className="invoice-signature-col">
                  <div className="invoice-signature-line" />
                  <p className="invoice-signature-label">Authorized Signature</p>
                </div>
                <div className="invoice-signature-col">
                  <div className="invoice-signature-line" />
                  <p className="invoice-signature-label">Guest Signature</p>
                </div>
              </div>

              <p className="text-center text-[7.5pt] text-neutral-600">
                Slip No. {receipt.slipNumber}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="print:hidden">
        <AppDevelopedByFooter />
      </div>
    </div>
  )
}
