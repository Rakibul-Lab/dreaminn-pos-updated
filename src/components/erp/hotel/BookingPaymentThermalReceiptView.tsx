'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import {
  INVOICE_BIN,
  INVOICE_HOTEL_MOBILE,
  INVOICE_MUSHAK,
} from '@/lib/invoice-display'
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
  stayTotal: number
  totalPaid: number
  balanceDue: number
  invoiceNumber: string | null
}

interface BookingPaymentThermalReceiptViewProps {
  paymentId: string
  autoPrint?: boolean
}

export function BookingPaymentThermalReceiptView({
  paymentId,
  autoPrint = false,
}: BookingPaymentThermalReceiptViewProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['booking-payment-receipt', paymentId],
    queryFn: () =>
      api.get<{ success: boolean; data: ReceiptData }>(`/payments/${paymentId}/receipt`),
    enabled: !!paymentId,
  })

  const receipt = data?.data

  useEffect(() => {
    if (!autoPrint || !receipt) return
    const timer = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(timer)
  }, [autoPrint, receipt])

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-6 w-40 mx-auto" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  if (isError || !receipt) {
    const message =
      error instanceof Error ? error.message : 'Could not load payment slip.'
    return (
      <div className="p-6 text-center text-sm space-y-2">
        <p className="text-red-600 font-medium">{message}</p>
        <p className="text-muted-foreground text-xs">
          If this persists, confirm you are logged in and the payment was recorded for a hotel
          booking.
        </p>
      </div>
    )
  }

  const locationLabel = receipt.roomNumber ? `Room ${receipt.roomNumber}` : null

  return (
    <div className="print-container pos-thermal-receipt-root flex flex-col items-center print:block">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          Print slip
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.close()}>
          Close tab
        </Button>
      </div>

      <div className="pos-thermal-receipt w-[80mm] max-w-[80mm] bg-white text-black font-mono text-[11px] leading-snug p-3 border border-dashed border-gray-300 print:border-0 print:p-2 print:shadow-none">
        <div className="text-center border-b border-dashed border-black pb-2 mb-2">
          <p className="text-sm font-bold uppercase tracking-wide">{receipt.hotelName}</p>
          <p className="text-[9px] mt-0.5 leading-tight">{receipt.hotelLocation}</p>
          <p className="text-[9px] mt-0.5">Mobile: {INVOICE_HOTEL_MOBILE}</p>
          <p className="text-[9px] mt-0.5">{INVOICE_MUSHAK}</p>
          <p className="text-[9px]">BIN: {INVOICE_BIN}</p>
          <p className="text-xs font-bold uppercase tracking-wide mt-2">
            {receipt.isRefund ? 'Refund Receipt' : 'Payment Receipt'}
          </p>
        </div>

        <div className="space-y-0.5 mb-2">
          <div className="flex justify-between gap-2">
            <span className="font-bold">Slip No.</span>
            <span className="text-right break-all">{receipt.slipNumber}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-bold">Date</span>
            <span>{format(new Date(receipt.paidAt), 'dd/MM/yyyy HH:mm')}</span>
          </div>
          {receipt.businessDate ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Business day</span>
              <span>{receipt.businessDate}</span>
            </div>
          ) : null}
        </div>

        <div className="border-t border-dashed border-black pt-2 space-y-0.5 mb-2">
          <div className="flex justify-between gap-2">
            <span className="font-bold">Guest</span>
            <span className="text-right">{receipt.guestName}</span>
          </div>
          {locationLabel ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Room</span>
              <span>{locationLabel}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <span className="font-bold">Conf. No.</span>
            <span className="text-right break-all">{receipt.confirmationNumber}</span>
          </div>
          {receipt.registrationNumber ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Reg. No.</span>
              <span>{receipt.registrationNumber}</span>
            </div>
          ) : null}
          {receipt.invoiceNumber ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Invoice</span>
              <span className="text-right break-all">{receipt.invoiceNumber}</span>
            </div>
          ) : null}
        </div>

        <div className="border-t border-dashed border-black pt-2 space-y-0.5 mb-2">
          <div className="flex justify-between gap-2">
            <span className="font-bold">Type</span>
            <span className="text-right">{receipt.paymentTypeLabel}</span>
          </div>
          <div className="flex justify-between gap-2 font-bold text-sm">
            <span>{receipt.isRefund ? 'Refunded' : 'Received'}</span>
            <span>
              {receipt.isRefund ? '-' : ''}৳{receipt.amount.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-bold">Method</span>
            <span>{receipt.methodLabel}</span>
          </div>
          {receipt.reference ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Reference</span>
              <span className="text-right break-all">{receipt.reference}</span>
            </div>
          ) : null}
          {receipt.accountDetail ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Account</span>
              <span>{receipt.accountDetail}</span>
            </div>
          ) : null}
          {receipt.receivedBy ? (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Received by</span>
              <span className="text-right">{receipt.receivedBy}</span>
            </div>
          ) : null}
          {receipt.notes?.trim() ? (
            <div className="pt-1">
              <p className="font-bold">Notes</p>
              <p className="text-[10px] whitespace-pre-wrap break-words">{receipt.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-dashed border-black pt-2 space-y-0.5 mb-2">
          <div className="flex justify-between gap-2">
            <span>Stay total</span>
            <span>৳{receipt.stayTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Total paid</span>
            <span>৳{receipt.totalPaid.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-2 font-bold">
            <span>Balance due</span>
            <span>৳{receipt.balanceDue.toFixed(2)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-black pt-2 text-center text-[10px]">
          <p>Thank you for your payment.</p>
          <p className="mt-1">{receipt.hotelName}</p>
          <p className="mt-1 text-[9px] text-gray-600">Ref: {receipt.paymentId}</p>
        </div>
      </div>
    </div>
  )
}
