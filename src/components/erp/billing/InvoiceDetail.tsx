'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { formatInvoiceNumberDisplay } from '@/lib/invoice-number'
import {
  resolveInvoiceHotelServicePercent,
  resolveInvoiceRoomVatAmount,
} from '@/lib/invoice-display'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import Image from 'next/image'
import {
  Printer, CreditCard, Building2, User, Phone, MapPin, Receipt
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'

interface InvoiceDetailProps {
  invoiceId: string
  onClose: () => void
}

interface Payment {
  id: string
  amount: number
  method: string
  paymentType: string
  reference: string | null
  notes: string | null
  createdAt: string
  receiver: { id: string; name: string }
}

interface InvoiceItem {
  id: string
  itemType: string
  description: string
  quantity: number
  unitPrice: number
  total: number
}

interface InvoiceData {
  id: string
  invoiceNumber: string
  bookingId: string
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
  status: string
  issuedAt: string | null
  paidAt: string | null
  createdAt: string
  booking: {
    id: string
    checkIn: string
    checkOut: string
    status: string
    customer: { id: string; name: string; phone: string; email: string | null; address: string | null }
    room: { id: string; roomNumber: string; totalPrice: number; type: { name: string } }
    charges: Array<{ id: string; chargeType: string; description: string; amount: number; quantity: number }>
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
  items: InvoiceItem[]
  payments: Payment[]
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground border-border',
  ISSUED: 'bg-sky-50 text-sky-700 border-sky-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
}

export default function InvoiceDetail({ invoiceId, onClose }: InvoiceDetailProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'CASH',
    paymentType: 'PARTIAL',
    reference: '',
    notes: '',
  })

  const { data: invoiceData, isLoading } = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: InvoiceData }>(`/invoices/${invoiceId}`)
      return res
    },
    enabled: !!invoiceId,
  })

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      return api.post('/payments', {
        amount: parseFloat(paymentForm.amount),
        method: paymentForm.method,
        paymentType: paymentForm.paymentType,
        bookingId: invoiceData?.data?.bookingId,
        invoiceId: invoiceId,
        reference: paymentForm.reference || null,
        notes: paymentForm.notes || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoiceId] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      toast({
        title: 'Payment Recorded',
        description: 'Payment saved — enter another or close when done',
      })
      setPaymentForm((f) => ({
        ...f,
        amount: '',
        reference: '',
        notes: '',
      }))
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message || 'Failed to record payment', variant: 'destructive' })
    },
  })

  const invoice = invoiceData?.data
  const roomItems = invoice?.items?.filter((i) => i.itemType === 'room_charge') || []
  const foodItems = invoice?.items?.filter((i) => i.itemType === 'food_order') || []
  const extraItems = invoice?.items?.filter((i) => i.itemType === 'extra_service') || []
  const discountItems = invoice?.items?.filter((i) => i.itemType === 'discount') || []
  const vatItems =
    invoice?.items?.filter((i) => i.itemType === 'vat_hotel' || i.itemType === 'vat_restaurant') || []
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
  const hotelVatPercent = invoice?.declaredVatPercent ?? 15
  const hotelServiceChargePercent = invoice?.declaredServiceChargePercent ?? 10
  const vatInclusiveRoom = invoice?.booking?.vatApplied === false
  const vatRates = Array.from(new Set(restaurantOrders.map((o) => Number(o.vatPercent || 0))))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
  const restaurantVatLabel = vatRates.length ? vatRates.map((r) => `${r}%`).join(', ') : '-'
  const hotelPartTotal = vatInclusiveRoom
    ? roomBill + extraBill
    : roomBill + roomVat + extraBill
  const restaurantPartTotal = restaurantBill + restaurantVat

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!invoice) {
    return <p className="text-center text-muted-foreground p-8">Invoice not found</p>
  }

  return (
    <div className="print-container">
      {/* Invoice Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-lg border bg-card">
              <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={40} height={40} className="h-full w-full object-cover" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Receipt className="h-6 w-6 text-amber-600" />
                RRP Dream Inn Invoice
              </h2>
            </div>
          </div>
          <p className="font-mono text-lg text-amber-700 mt-1">
            {formatInvoiceNumberDisplay(invoice.invoiceNumber)}
          </p>
          <p className="text-sm text-muted-foreground">
            Issued: {invoice.issuedAt ? format(new Date(invoice.issuedAt), 'MMM dd, yyyy HH:mm') : 'N/A'}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Badge variant="outline" className={`text-sm px-3 py-1 ${statusColors[invoice.status] || ''}`}>
            {invoice.status.replace('_', ' ')}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/invoice/${invoice.id}`, '_blank', 'noopener,noreferrer')}
          >
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {invoice.dueAmount > 0 && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setShowPaymentDialog(true)}
            >
              <CreditCard className="h-4 w-4 mr-2" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* Hotel/Guest Info */}
      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 text-foreground font-semibold">
              <Building2 className="h-4 w-4 text-amber-600" />
              RRP Dream Inn
            </div>
            <p className="text-sm text-muted-foreground">Hotel & Restaurant</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2 text-foreground font-semibold">
              <User className="h-4 w-4 text-emerald-600" />
              Guest Information
            </div>
            <p className="font-medium">{invoice.booking?.customer?.name}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" /> {invoice.booking?.customer?.phone}
            </p>
            {invoice.booking?.customer?.address && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {invoice.booking.customer.address}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Room Charges */}
      {roomItems.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground">Room Charges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Nights</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roomItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">৳{item.unitPrice.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">৳{item.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Food Charges */}
      {foodItems.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground">Food & Beverage Charges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {foodItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">৳{item.unitPrice.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">৳{item.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Discounts & VAT line items */}
      {(discountItems.length > 0 || vatItems.length > 0) && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground">Discounts & taxes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...discountItems, ...vatItems].map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${item.total < 0 ? 'text-emerald-700' : ''}`}
                    >
                      {item.total < 0 ? '-' : ''}৳{Math.abs(item.total).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Extra Services */}
      {extraItems.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground">Extra Services</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extraItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">৳{item.unitPrice.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">৳{item.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card className="mb-4 border-2 border-amber-200">
        <CardContent className="p-4">
          <div className="space-y-2">
            <div className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hotel Part</p>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Room Bill</span>
                <span>৳{roomBill.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Room VAT</span>
                <span>৳{roomVat.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Hotel VAT Rate</span>
                <span>{hotelVatPercent}%</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Service Charge Rate</span>
                <span>{hotelServiceChargePercent}%</span>
              </div>
              {extraBill > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Extra Charges</span>
                  <span>৳{extraBill.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5">
                <span>Hotel Total</span>
                <span>৳{hotelPartTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Restaurant Part</p>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>৳{restaurantSubtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-emerald-700">
                <span className="text-muted-foreground">Discount</span>
                <span>-৳{restaurantDiscount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">VAT ({restaurantVatLabel})</span>
                <span>৳{restaurantVat.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5">
                <span>Total</span>
                <span>৳{restaurantPartTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Combined Total</span>
              <span>৳{(hotelPartTotal + restaurantPartTotal).toLocaleString()}</span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Discount</span>
                <span>-৳{invoice.discount.toLocaleString()}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Subtotal</span>
              <span>৳{invoice.totalAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Paid</span>
              <span>৳{invoice.paidAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-lg">
              <span className={invoice.dueAmount > 0 ? 'text-red-600' : 'text-emerald-600'}>
                Due Amount
              </span>
              <span className={invoice.dueAmount > 0 ? 'text-red-600' : 'text-emerald-600'}>
                ৳{invoice.dueAmount.toLocaleString()}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      {invoice.payments && invoice.payments.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground">Payment History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Received By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{format(new Date(payment.createdAt), 'MMM dd, yyyy')}</TableCell>
                    <TableCell>{payment.method}</TableCell>
                    <TableCell>{payment.paymentType}</TableCell>
                    <TableCell className="font-mono text-xs">{payment.reference || '-'}</TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">
                      ৳{payment.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>{payment.receiver?.name || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Record Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (৳)</Label>
              <Input
                type="number"
                placeholder="Enter payment amount"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Due: ৳{invoice.dueAmount.toLocaleString()}</p>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm((f) => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Type</Label>
              <Select value={paymentForm.paymentType} onValueChange={(v) => setPaymentForm((f) => ({ ...f, paymentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="FINAL">Final</SelectItem>
                  <SelectItem value="INITIAL">Initial</SelectItem>
                  <SelectItem value="ADVANCE">Advance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference (optional)</Label>
              <Input
                placeholder="Transaction reference"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Payment notes"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Done</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!paymentForm.amount || parseFloat(paymentForm.amount) <= 0 || recordPaymentMutation.isPending}
              onClick={() => recordPaymentMutation.mutate()}
            >
              {recordPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
