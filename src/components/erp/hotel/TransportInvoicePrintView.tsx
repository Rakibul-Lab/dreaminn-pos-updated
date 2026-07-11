'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Loader2, Printer, Download } from 'lucide-react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBdt } from '@/lib/currency'
import { formatAmountInWords } from '@/lib/amount-in-words'
import { INVOICE_ZERO_DISCOUNT_DISPLAY, INVOICE_HOTEL_ADDRESS_LINES } from '@/lib/invoice-display'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'
import { toast } from 'sonner'

type TransportInvoiceDocument = {
  hotelName: string
  hotelAddress: string
  hotelMobile: string
  bin: string
  mushak: string
  vatPercent: number
  invoice: {
    id: string
    invoiceNumber: string
    status: string
    subtotal: number
    vatAmount: number
    discount: number
    totalAmount: number
    paidAmount: number
    dueAmount: number
    issuedAt: string
    paidAt: string | null
  }
  payments?: Array<{
    amount: number
    method: string
    methodLabel: string
    reference: string | null
    createdAt: string
  }>
  paymentSummary?: {
    byMethod: Array<{ label: string; amount: number }>
    totalPaid: number
    due: number
  }
  sale: {
    saleNumber: string
    saleType: string
    customerName: string
    customerPhone: string | null
    routeFrom: string | null
    routeTo: string | null
    vehicleType: string | null
    tripDate: string | null
    roomNumber: string | null
    notes: string | null
    createdAt: string
    paymentMethodLabel: string | null
    createdByName: string | null
    items: Array<{
      serviceName: string
      description: string | null
      quantity: number
      unitPrice: number
      lineTotal: number
    }>
  }
}

interface TransportInvoicePrintViewProps {
  saleId: string
  autoPrint?: boolean
  showToolbar?: boolean
}

export function TransportInvoicePrintView({
  saleId,
  autoPrint = false,
  showToolbar = true,
}: TransportInvoicePrintViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['transport-invoice', saleId],
    queryFn: () =>
      api.get<{ success: boolean; data: TransportInvoiceDocument }>(
        `/transport-sales/${saleId}/invoice`
      ),
    enabled: !!saleId,
  })

  const doc = data?.data
  const paymentSummary = doc?.paymentSummary
  const paymentMethodRows =
    paymentSummary?.byMethod?.length
      ? paymentSummary.byMethod
      : doc?.sale.paymentMethodLabel
        ? [{ label: doc.sale.paymentMethodLabel, amount: doc.invoice.paidAmount }]
        : []

  useEffect(() => {
    if (!autoPrint || !doc) return
    const timer = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(timer)
  }, [autoPrint, doc])

  const handlePrint = () => window.print()

  const handleDownloadPdf = async () => {
    if (!documentRef.current || !doc) return
    setDownloading(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadInvoicePdfFromElement } = await import('@/lib/invoice-pdf')
      await downloadInvoicePdfFromElement(
        documentRef.current,
        `transport-invoice-${doc.invoice.invoiceNumber}.pdf`
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
      <div className="mx-auto max-w-4xl p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (isError || !doc) {
    const message = error instanceof Error ? error.message : 'Transport invoice not found'
    return <div className="p-8 text-sm text-red-600">{message}</div>
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
      {showToolbar ? (
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
        </div>
      ) : null}

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
                <p className="text-sm font-bold leading-tight">{doc.hotelName}</p>
                {INVOICE_HOTEL_ADDRESS_LINES.map((line) => (
                  <p
                    key={line}
                    className="invoice-hotel-address text-black text-[7pt] leading-snug whitespace-nowrap"
                  >
                    {line}
                  </p>
                ))}
                <p className="invoice-hotel-mobile text-black text-[7.5pt] leading-snug">
                  Mobile: {doc.hotelMobile}
                </p>
              </div>
            </div>

            <div className="invoice-pdf-header-invoice flex justify-center md:justify-center">
              <div className="space-y-0.5 text-left">
                <p className="text-[9pt] font-semibold leading-tight whitespace-nowrap">
                  Transport Invoice:{' '}
                  <span className="font-mono">{doc.invoice.invoiceNumber}</span>
                </p>
                <p className="text-[8pt] leading-tight whitespace-nowrap">
                  Date: {format(new Date(doc.invoice.issuedAt), 'dd/MM/yyyy')}
                </p>
                <p className="text-[8pt] leading-tight whitespace-nowrap">
                  Sale Ref: {doc.sale.saleNumber}
                </p>
              </div>
            </div>

            <div className="invoice-tax-meta space-y-0.5 justify-self-start text-left md:justify-self-end md:text-right">
              <p className="text-[8pt] leading-tight whitespace-nowrap">{doc.mushak}</p>
              <p className="text-[8pt] leading-tight whitespace-nowrap">BIN: {doc.bin}</p>
            </div>
          </div>

          <div className="invoice-pdf-body">
        <div className="mb-6 grid gap-4 border-b pb-4 text-sm md:grid-cols-2">
          <div className="space-y-1">
            <p>
              <span className="text-neutral-500">Status:</span>{' '}
              <span className="font-medium">{doc.invoice.status}</span>
            </p>
            <p>
              <span className="text-neutral-500">Type:</span>{' '}
              {doc.sale.saleType === 'ROOM' ? 'In-house guest' : 'Walk-in guest'}
            </p>
            {doc.sale.roomNumber ? (
              <p>
                <span className="text-neutral-500">Room:</span> {doc.sale.roomNumber}
              </p>
            ) : null}
            {doc.sale.tripDate ? (
              <p>
                <span className="text-neutral-500">Trip date:</span>{' '}
                {format(new Date(doc.sale.tripDate), 'dd MMM yyyy, hh:mm a')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1 md:text-right">
            <p>
              <span className="text-neutral-500">Guest:</span>{' '}
              <span className="font-semibold">{doc.sale.customerName}</span>
            </p>
            {doc.sale.customerPhone ? (
              <p>
                <span className="text-neutral-500">Phone:</span> {doc.sale.customerPhone}
              </p>
            ) : null}
            {doc.sale.vehicleType ? (
              <p>
                <span className="text-neutral-500">Vehicle:</span> {doc.sale.vehicleType}
              </p>
            ) : null}
            {doc.sale.routeFrom || doc.sale.routeTo ? (
              <p>
                <span className="text-neutral-500">Route:</span>{' '}
                {[doc.sale.routeFrom, doc.sale.routeTo].filter(Boolean).join(' → ')}
              </p>
            ) : null}
          </div>
        </div>

        <table className="mb-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-neutral-100">
              <th className="px-2 py-2 text-left font-semibold">Service</th>
              <th className="px-2 py-2 text-right font-semibold">Qty</th>
              <th className="px-2 py-2 text-right font-semibold">Rate</th>
              <th className="px-2 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.sale.items.map((item, index) => (
              <tr key={index} className="border-b">
                <td className="px-2 py-2">
                  <p className="font-medium">{item.serviceName}</p>
                  {item.description ? (
                    <p className="text-xs text-neutral-500">{item.description}</p>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right">{item.quantity}</td>
                <td className="px-2 py-2 text-right">{formatBdt(item.unitPrice)}</td>
                <td className="px-2 py-2 text-right">{formatBdt(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-pdf-summary w-full text-[8.5pt]">
          <div className="rounded border border-border p-2.5">
            {doc.invoice.vatAmount > 0 ? (
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Subtotal</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatBdt(doc.invoice.subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">VAT ({doc.vatPercent}%)</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatBdt(doc.invoice.vatAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            {doc.invoice.discount > 0 ? (
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap text-red-600">Discount</td>
                    <td className="py-1 text-right whitespace-nowrap text-red-600">
                      -{formatBdt(doc.invoice.discount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <table className={`w-full${doc.invoice.vatAmount > 0 || doc.invoice.discount > 0 ? ' border-t border-border mt-2' : ''}`}>
              <tbody>
                <tr>
                  <td className="py-1 pr-2 whitespace-nowrap font-bold text-[9pt]">Total</td>
                  <td className="py-1 text-right whitespace-nowrap font-bold text-[9pt]">
                    {formatBdt(doc.invoice.totalAmount)}
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="w-full border-t border-border mt-2">
              <tbody>
                <tr>
                  <td className="py-1 pr-2 whitespace-nowrap">Paid</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {formatBdt(paymentSummary?.totalPaid ?? doc.invoice.paidAmount)}
                  </td>
                </tr>
                {paymentMethodRows.map((row) => (
                  <tr key={row.label}>
                    <td className="py-1 pr-2 whitespace-nowrap">{row.label}</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {row.amount > 0 ? formatBdt(row.amount) : INVOICE_ZERO_DISCOUNT_DISPLAY}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1 pr-2 font-bold text-[9pt] whitespace-nowrap">
                    Balance Due
                  </td>
                  <td className="py-1 text-right font-bold text-[9pt] whitespace-nowrap">
                    {formatBdt(paymentSummary?.due ?? doc.invoice.dueAmount)}
                  </td>
                </tr>
              </tbody>
            </table>

            {(doc.payments ?? []).some(
              (payment) => payment.reference && payment.reference !== doc.sale.saleNumber
            ) ? (
              <table className="w-full border-t border-border mt-2">
                <tbody>
                  {(doc.payments ?? [])
                    .filter(
                      (payment) => payment.reference && payment.reference !== doc.sale.saleNumber
                    )
                    .map((payment, index) => (
                      <tr key={`${payment.method}-${index}`}>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {payment.methodLabel} ref
                        </td>
                        <td className="py-1 text-right whitespace-nowrap">{payment.reference}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}

            <p className="text-[8pt] border-t border-border pt-2 mt-2 italic">
              <span className="font-medium not-italic">In words: </span>
              {formatAmountInWords(doc.invoice.totalAmount)}
            </p>
          </div>
        </div>

        {doc.sale.notes ? (
          <p className="mt-3 text-sm text-neutral-600">
            <span className="font-medium">Notes:</span> {doc.sale.notes}
          </p>
        ) : null}

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="mb-8 border-b border-black" />
            <p className="text-center">Authorized Signature</p>
          </div>
          <div>
            <div className="mb-8 border-b border-black" />
            <p className="text-center">Guest Signature</p>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-neutral-500">
          Thank you for choosing {doc.hotelName} transport services.
        </p>
          </div>
        </div>
      </div>

      <div className="print:hidden">
        <AppDevelopedByFooter />
      </div>
    </div>
  )
}
