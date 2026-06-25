'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { formatInvoiceNumberDisplay } from '@/lib/invoice-number';
import { format } from 'date-fns';
import { Building2, FileText, History, Loader2, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/erp/shared/StatusBadge';
import { formatBdt } from '@/lib/currency';
import { formatGuestId } from '@/lib/id-type-label';
import { formatListBookingCheckIn, formatListBookingCheckOut } from '@/lib/hotel-times';
import { useHotelTimes } from '@/hooks/use-hotel-times';
import {
  formatPaymentMethod,
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
} from '@/lib/payment-method';
import { toast } from 'sonner';

type GuestHistoryBill = {
  id: string;
  guestName: string;
  roomNumber?: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  billedAt: string;
  invoiceId?: string | null;
};

type GuestHistoryStay = {
  booking: {
    id: string;
    confirmationNumber?: string | null;
    registrationNumber?: string | null;
    status: string;
    checkIn: string;
    checkOut: string;
    actualCheckIn?: string | null;
    actualCheckOut?: string | null;
    totalWithVat: number;
    dueAmount: number;
    room: { roomNumber: string; type: { name: string } };
    customer: { name: string; phone: string; email?: string | null };
  };
  bill: GuestHistoryBill | null;
  invoice: {
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
    status: string;
    issuedAt?: string | null;
  } | null;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    paymentType: string;
    reference?: string | null;
    notes?: string | null;
    createdAt: string;
    receiver: { name: string };
  }>;
};

type GuestHistoryData = {
  guest: {
    id: string;
    guestName: string;
    phone?: string | null;
    email?: string | null;
    nationality?: string | null;
    registrationNumber?: string | null;
    address?: string | null;
    idType?: string | null;
    idNumber?: string | null;
    designation?: string | null;
    notes?: string | null;
  };
  company: {
    id: string;
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    dueAmount?: number;
  };
  stays: GuestHistoryStay[];
  totalDue: number;
};

interface CompanyLedgerGuestHistoryViewProps {
  guestId: string;
  showClose?: boolean;
}

export function CompanyLedgerGuestHistoryView({
  guestId,
  showClose = true,
}: CompanyLedgerGuestHistoryViewProps) {
  const queryClient = useQueryClient();
  const { times } = useHotelTimes();
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payBill, setPayBill] = useState<GuestHistoryBill | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-ledger-guest-history', guestId],
    queryFn: () =>
      api.get<{ success: boolean; data: GuestHistoryData }>(
        `/company-ledger/guests/${guestId}`
      ),
  });

  const history = data?.data;

  const payMutation = useMutation({
    mutationFn: (payload: {
      billId: string;
      amount: number;
      method: string;
      reference?: string;
      notes?: string;
    }) => api.post(`/company-ledger/bills/${payload.billId}/payment`, payload),
    onSuccess: (res: {
      success?: boolean;
      message?: string;
      error?: string;
      data?: { billDueAmount?: number };
    }, variables) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to record payment');
        return;
      }
      const newDue = res.data?.billDueAmount ?? 0;
      toast.success(
        newDue <= 0.009
          ? res.message || 'Payment recorded — bill cleared'
          : res.message || 'Payment recorded — enter another or close when done'
      );
      if (newDue <= 0.009) {
        setPayDialogOpen(false);
        setPayBill(null);
      } else {
        setPayBill((prev) =>
          prev && prev.id === variables.billId ? { ...prev, dueAmount: newDue } : prev
        );
        setPayAmount(String(newDue));
      }
      setPayReference('');
      setPayNotes('');
      setPayMethod('CASH');
      queryClient.invalidateQueries({ queryKey: ['company-ledger-guest-history', guestId] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger-detail'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => toast.error('Failed to record payment'),
  });

  const openPayDialog = (bill: GuestHistoryBill) => {
    setPayBill(bill);
    setPayAmount(String(bill.dueAmount));
    setPayMethod('CASH');
    setPayReference('');
    setPayNotes('');
    setPayDialogOpen(true);
  };

  const submitPayment = () => {
    if (!payBill) return;
    const amount = parseFloat(payAmount) || 0;
    if (amount <= 0) {
      toast.error('Enter a valid payment amount');
      return;
    }
    payMutation.mutate({
      billId: payBill.id,
      amount,
      method: payMethod,
      reference: payReference.trim() || undefined,
      notes: payNotes.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (isError || !history) {
    return <div className="p-8 text-red-600">Failed to load guest history.</div>;
  }

  const { guest, company, stays, totalDue } = history;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <History className="h-5 w-5 text-amber-600" />
            {guest.guestName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {company.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={totalDue > 0 ? 'text-red-700' : 'text-emerald-700'}>
            Total due: {formatBdt(totalDue)}
          </Badge>
          {showClose && (
            <Button variant="outline" size="sm" onClick={() => window.close()}>
              Close tab
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Guest details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
          <p>
            <span className="text-muted-foreground">Phone:</span> {guest.phone || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Email:</span> {guest.email || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Nationality:</span> {guest.nationality || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Registration no.:</span>{' '}
            {guest.registrationNumber ||
              stays.find((s) => s.booking.registrationNumber)?.booking.registrationNumber ||
              '—'}
          </p>
          <p>
            <span className="text-muted-foreground">ID:</span>{' '}
            {formatGuestId(guest.idType, guest.idNumber)}
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Address:</span> {guest.address || '—'}
          </p>
          {guest.notes ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Notes:</span> {guest.notes}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stays, invoices & payments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stays.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No reservation history for this guest yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="py-2.5 px-4 font-medium">Stay</th>
                    <th className="py-2.5 px-4 font-medium">Room</th>
                    <th className="py-2.5 px-4 font-medium">Booking</th>
                    <th className="py-2.5 px-4 font-medium text-right">Total</th>
                    <th className="py-2.5 px-4 font-medium text-right">Due</th>
                    <th className="py-2.5 px-4 font-medium">Invoice</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stays.map((stay) => {
                    const b = stay.booking;
                    const bill = stay.bill;
                    const invoice = stay.invoice;
                    return (
                      <tr key={b.id} className="border-b last:border-0 align-top">
                        <td className="py-3 px-4">
                          <p className="font-medium">
                            {formatListBookingCheckIn(b, times, true)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            to {formatListBookingCheckOut(b, times, true)}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium">{b.room.roomNumber}</p>
                          <p className="text-xs text-muted-foreground">{b.room.type.name}</p>
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={b.status} className="text-xs" />
                          {b.registrationNumber ? (
                            <p className="text-xs font-mono text-muted-foreground mt-1">
                              Reg. {b.registrationNumber}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {formatBdt(bill?.totalAmount ?? b.totalWithVat)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={(bill?.dueAmount ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-emerald-600'}>
                            {formatBdt(bill?.dueAmount ?? 0)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {invoice ? (
                            <div className="space-y-1">
                              <p className="font-medium">{formatInvoiceNumberDisplay(invoice.invoiceNumber)}</p>
                              <p className="text-xs text-muted-foreground">
                                {invoice.issuedAt
                                  ? format(new Date(invoice.issuedAt), 'dd/MM/yyyy')
                                  : '—'}
                              </p>
                              <StatusBadge status={invoice.status} className="text-xs" />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-end flex-wrap gap-1">
                            {invoice && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                title="View invoice"
                                onClick={() =>
                                  window.open(`/invoice/${invoice.id}`, '_blank', 'noopener,noreferrer')
                                }
                              >
                                <Receipt className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              title="Reservation document"
                              onClick={() =>
                                window.open(`/reservation/${b.id}`, '_blank', 'noopener,noreferrer')
                              }
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            {bill && bill.dueAmount > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                                onClick={() => openPayDialog(bill)}
                              >
                                Receive payment
                              </Button>
                            )}
                          </div>
                          {stay.payments.length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground text-right space-y-0.5">
                              {stay.payments.slice(0, 3).map((p) => (
                                <p key={p.id}>
                                  {format(new Date(p.createdAt), 'dd/MM/yy')} ·{' '}
                                  {formatBdt(p.amount)} · {formatPaymentMethod(p.method)}
                                </p>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Receive company payment</DialogTitle>
          </DialogHeader>
          {payBill && (
            <div className="grid gap-3 py-1">
              <p className="text-sm text-muted-foreground">
                Due on this bill: <strong className="text-foreground">{formatBdt(payBill.dueAmount)}</strong>
              </p>
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  max={payBill.dueAmount}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment method *</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="Transaction / receipt no."
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={payMutation.isPending}
              onClick={submitPayment}
            >
              {payMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Record payment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
