'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { INVOICE_BIN, INVOICE_HOTEL_ADDRESS, INVOICE_HOTEL_MOBILE, INVOICE_MUSHAK } from '@/lib/invoice-display'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type ReceiptData = {
  hotelName: string
  saleNumber: string
  saleTypeLabel: string
  createdAt: string
  roomNumber: string | null
  customerName: string | null
  customerPhone: string | null
  items: {
    name: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }[]
  subtotal: number
  totalAmount: number
  payment: {
    amount: number
    methodLabel: string
    receivedBy: string | null
    paidAt: string
  } | null
  notes: string | null
}

interface HotelBeverageThermalReceiptViewProps {
  saleId: string
  autoPrint?: boolean
}

export function HotelBeverageThermalReceiptView({
  saleId,
  autoPrint = false,
}: HotelBeverageThermalReceiptViewProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hotel-beverage-receipt', saleId],
    queryFn: () =>
      api.get<{ success: boolean; data: ReceiptData }>(
        `/hotel-beverage-sales/${saleId}/receipt`
      ),
    enabled: !!saleId,
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
    return <div className="p-6 text-center text-red-600 text-sm">Could not load receipt.</div>
  }

  const forLabel = receipt.roomNumber
    ? `Room ${receipt.roomNumber}`
    : receipt.customerName
      ? receipt.customerPhone
        ? `${receipt.customerName} (${receipt.customerPhone})`
        : receipt.customerName
      : null

  return (
    <div className="print-container pos-thermal-receipt-root flex flex-col items-center print:block">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          Print receipt
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.close()}>
          Close tab
        </Button>
      </div>

      <div className="pos-thermal-receipt w-[80mm] max-w-[80mm] bg-white text-black font-mono text-[11px] leading-snug p-3 border border-dashed border-gray-300 print:border-0 print:p-2 print:shadow-none">
        <div className="text-center border-b border-dashed border-black pb-2 mb-2">
          <p className="text-sm font-bold uppercase tracking-wide">{receipt.hotelName}</p>
          <p className="text-[9px] mt-0.5 leading-tight">{INVOICE_HOTEL_ADDRESS}</p>
          <p className="text-[9px] mt-0.5">Mobile: {INVOICE_HOTEL_MOBILE}</p>
          <p className="text-[9px] mt-0.5">{INVOICE_MUSHAK}</p>
          <p className="text-[9px]">BIN: {INVOICE_BIN}</p>
          <p className="text-[10px] mt-1">Beverage Sale</p>
        </div>

        <div className="space-y-0.5 mb-2">
          <p>
            <span className="font-bold">Sale:</span> {receipt.saleNumber}
          </p>
          <p>
            <span className="font-bold">Type:</span> {receipt.saleTypeLabel}
          </p>
          {forLabel && (
            <p>
              <span className="font-bold">For:</span> {forLabel}
            </p>
          )}
          <p>
            <span className="font-bold">Date:</span>{' '}
            {format(new Date(receipt.createdAt), 'dd/MM/yyyy HH:mm')}
          </p>
        </div>

        <div className="border-t border-dashed border-black pt-2 mb-2">
          {receipt.items.map((item, idx) => (
            <div key={idx} className="mb-1.5">
              <div className="flex justify-between gap-2">
                <span className="flex-1 break-words">{item.name}</span>
                <span className="shrink-0">৳{item.lineTotal.toFixed(0)}</span>
              </div>
              <div className="text-[10px] text-gray-700 pl-1">
                {item.quantity} x ৳{item.unitPrice.toFixed(0)}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-black pt-2 space-y-0.5 mb-2">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>৳{receipt.subtotal.toFixed(0)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm pt-1">
            <span>TOTAL</span>
            <span>৳{receipt.totalAmount.toFixed(0)}</span>
          </div>
        </div>

        {receipt.payment && (
          <div className="border-t border-dashed border-black pt-2 space-y-0.5 mb-2">
            <p className="font-bold text-center">PAYMENT</p>
            <div className="flex justify-between">
              <span>Paid</span>
              <span>৳{receipt.payment.amount.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Method</span>
              <span>{receipt.payment.methodLabel}</span>
            </div>
            {receipt.payment.receivedBy && (
              <div className="flex justify-between">
                <span>By</span>
                <span>{receipt.payment.receivedBy}</span>
              </div>
            )}
            <p className="text-[10px] text-center pt-1">
              {format(new Date(receipt.payment.paidAt), 'dd/MM/yyyy HH:mm')}
            </p>
          </div>
        )}

        {receipt.notes?.trim() && (
          <div className="border-t border-dashed border-black pt-2 mb-2 text-[10px]">
            <p className="font-bold">Notes</p>
            <p>{receipt.notes}</p>
          </div>
        )}

        <div className="text-center border-t border-dashed border-black pt-2 text-[10px]">
          <p>Thank you!</p>
          <p className="mt-1">{receipt.hotelName}</p>
        </div>
      </div>
    </div>
  )
}
