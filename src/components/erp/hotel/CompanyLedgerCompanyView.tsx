'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { format } from 'date-fns';
import { Building2, CalendarRange, Eye, FileDown, History, Loader2, Phone, Mail, MapPin, Search } from 'lucide-react';
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
import { formatBdt } from '@/lib/currency';
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method';
import { openCompanyLedgerGuestHistoryTab } from '@/lib/company-ledger-navigation';
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter';
import {
  buildCompanyLedgerGuestsExportQuery,
  downloadCompanyLedgerGuestsPdf,
  type CompanyLedgerGuestExportRecord,
} from '@/lib/company-ledger-guests-export';
import { useAuthStore } from '@/lib/auth-store';
import { useHotelTimes } from '@/hooks/use-hotel-times';
import { toast } from 'sonner';

type CompanyBill = {
  id: string;
  billType?: string;
  guestName: string;
  roomNumber?: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  billedAt: string;
  invoiceId?: string | null;
};

type CompanyGuest = CompanyLedgerGuestExportRecord & {
  id: string;
};

type CompanyDetail = {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  totalBilled?: number;
  totalPaid?: number;
  dueAmount?: number;
  bills: CompanyBill[];
};

interface CompanyLedgerCompanyViewProps {
  companyId: string;
  showClose?: boolean;
}

export function CompanyLedgerCompanyView({
  companyId,
  showClose = true,
}: CompanyLedgerCompanyViewProps) {
  const queryClient = useQueryClient();
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payBill, setPayBill] = useState<CompanyBill | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [guestSearchInput, setGuestSearchInput] = useState('');
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [guestDatePreset, setGuestDatePreset] = useState<BookingDatePreset>('all');
  const [guestCustomDateFrom, setGuestCustomDateFrom] = useState('');
  const [guestCustomDateTo, setGuestCustomDateTo] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const user = useAuthStore((s) => s.user);
  const { times } = useHotelTimes();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGuestSearchQuery(guestSearchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [guestSearchInput]);

  const guestDateRange = useMemo(
    () => resolveBookingDateRange(guestDatePreset, guestCustomDateFrom, guestCustomDateTo),
    [guestDatePreset, guestCustomDateFrom, guestCustomDateTo]
  );

  const buildGuestListQuery = () => {
    const params = new URLSearchParams();
    if (guestSearchQuery) params.set('search', guestSearchQuery);
    if (guestDateRange.dateFrom) params.set('dateFrom', guestDateRange.dateFrom);
    if (guestDateRange.dateTo) params.set('dateTo', guestDateRange.dateTo);
    const qs = params.toString();
    return `/company-ledger/${companyId}/guests${qs ? `?${qs}` : ''}`;
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-ledger-detail', companyId],
    queryFn: () =>
      api.get<{ success: boolean; data: CompanyDetail }>(`/company-ledger/${companyId}`),
  });

  const {
    data: guestsData,
    isLoading: guestsLoading,
    isFetching: guestsFetching,
  } = useQuery({
    queryKey: [
      'company-ledger-guests',
      companyId,
      guestSearchQuery,
      guestDatePreset,
      guestCustomDateFrom,
      guestCustomDateTo,
    ],
    queryFn: () =>
      api.get<{ success: boolean; data: CompanyGuest[] }>(buildGuestListQuery()),
    enabled: !!companyId,
  });

  const company = data?.data;
  const guests = guestsData?.data ?? [];
  const hasGuestFilters =
    !!guestSearchQuery ||
    guestDatePreset !== 'all' ||
    !!guestCustomDateFrom ||
    !!guestCustomDateTo;

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
      queryClient.invalidateQueries({ queryKey: ['company-ledger-detail', companyId] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger-guests', companyId] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger-guest-history'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => toast.error('Failed to record payment'),
  });

  const openPayDialog = (bill: CompanyBill) => {
    setPayBill(bill);
    setPayAmount(String(bill.dueAmount));
    setPayMethod('CASH');
    setPayReference('');
    setPayNotes('');
    setPayDialogOpen(true);
  };

  const handleExportPdf = async () => {
    if (!company) return;
    setExportingPdf(true);
    const toastId = toast.loading('Preparing PDF export…');
    try {
      const url = buildCompanyLedgerGuestsExportQuery(companyId, {
        search: guestSearchQuery,
        dateFrom: guestDateRange.dateFrom,
        dateTo: guestDateRange.dateTo,
      });
      const res = await api.get<{ success: boolean; data: CompanyGuest[] }>(url);
      if (!res?.success) {
        throw new Error('Failed to fetch guests for export');
      }
      const rows = res.data ?? [];
      if (!rows.length) {
        toast.error('No guests match the current filters', { id: toastId });
        return;
      }
      await downloadCompanyLedgerGuestsPdf(
        rows,
        {
          companyName: company.name,
          companyBilled: company.totalBilled ?? 0,
          companyPaid: company.totalPaid ?? 0,
          companyDue: company.dueAmount ?? 0,
          datePreset: guestDatePreset,
          customDateFrom: guestCustomDateFrom,
          customDateTo: guestCustomDateTo,
          exportedAt: new Date(),
          generatedBy: user
            ? { name: user.name, email: user.email, role: user.role }
            : undefined,
        },
        times
      );
      toast.success(`Exported ${rows.length} guest(s) to PDF`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExportingPdf(false);
    }
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
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (isError || !company) {
    return <div className="p-8 text-red-600">Failed to load company ledger.</div>;
  }

  const outstandingBills = company.bills.filter(
    (b) => b.dueAmount > 0 && (b.billType === 'BOOKING' || !b.billType)
  );
  const pendingEntryBills = company.bills.filter(
    (b) => b.dueAmount > 0 && b.billType === 'RESERVATION_ENTRY'
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-600" />
            {company.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {company.contactPerson && <span>Contact: {company.contactPerson}</span>}
            {company.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {company.phone}
              </span>
            )}
            {company.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {company.email}
              </span>
            )}
            {company.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {company.address}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Billed: {formatBdt(company.totalBilled ?? 0)}</Badge>
          <Badge variant="outline" className="text-emerald-700">
            Paid: {formatBdt(company.totalPaid ?? 0)}
          </Badge>
          <Badge
            variant="outline"
            className={(company.dueAmount ?? 0) > 0 ? 'text-red-700' : 'text-emerald-700'}
          >
            Due: {formatBdt(company.dueAmount ?? 0)}
          </Badge>
          {showClose && (
            <Button variant="outline" size="sm" onClick={() => window.close()}>
              Close tab
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 space-y-3">
          <CardTitle className="text-base">Guest list</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search guest name, phone, reg. no., nationality..."
                value={guestSearchInput}
                onChange={(e) => setGuestSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={guestDatePreset}
              onValueChange={(v) => setGuestDatePreset(v as BookingDatePreset)}
            >
              <SelectTrigger className="w-44">
                <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Stay date" />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_DATE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {guestDatePreset === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="company-guest-date-from" className="text-xs text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="company-guest-date-from"
                    type="date"
                    value={guestCustomDateFrom}
                    onChange={(e) => setGuestCustomDateFrom(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="company-guest-date-to" className="text-xs text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="company-guest-date-to"
                    type="date"
                    value={guestCustomDateTo}
                    min={guestCustomDateFrom || undefined}
                    onChange={(e) => setGuestCustomDateTo(e.target.value)}
                    className="w-40"
                  />
                </div>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={exportingPdf || guestsLoading}
              onClick={() => void handleExportPdf()}
            >
              {exportingPdf ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              Export PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {guestsLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : guests.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {hasGuestFilters
                ? 'No guests match your search or date filter.'
                : 'No guests yet. Guests are added when you make a reservation with this company.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="py-2.5 px-4 font-medium">Guest</th>
                    <th className="py-2.5 px-4 font-medium">Phone</th>
                    <th className="py-2.5 px-4 font-medium">Nationality</th>
                    <th className="py-2.5 px-4 font-medium">Registration No.</th>
                    <th className="py-2.5 px-4 font-medium">Last stay</th>
                    <th className="py-2.5 px-4 font-medium text-right">Due</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((guest) => (
                    <tr
                      key={guest.id}
                      className={`border-b last:border-0 ${guestsFetching ? 'opacity-70' : ''}`}
                    >
                      <td className="py-3 px-4 font-medium">{guest.guestName}</td>
                      <td className="py-3 px-4">{guest.phone || '—'}</td>
                      <td className="py-3 px-4">{guest.nationality || '—'}</td>
                      <td className="py-3 px-4">{guest.registrationNumber || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {guest.latestStayCheckIn
                          ? format(new Date(guest.latestStayCheckIn), 'dd/MM/yyyy')
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={
                            guest.totalDue > 0 ? 'text-red-600 font-medium' : 'text-emerald-600'
                          }
                        >
                          {formatBdt(guest.totalDue)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                            title="View guest history, invoices & settle due"
                            onClick={() => openCompanyLedgerGuestHistoryTab(guest.id)}
                          >
                            <History className="h-4 w-4 mr-1.5" />
                            View & settle
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Outstanding bills
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pendingEntryBills.length > 0 ? (
            <p className="mx-6 mt-4 mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {pendingEntryBills.length} reservation entr
              {pendingEntryBills.length === 1 ? 'y' : 'ies'} with advance due (
              {formatBdt(pendingEntryBills.reduce((s, b) => s + b.dueAmount, 0))}). Convert to
              booking or cancel the entry to adjust — payment is recorded after checkout.
            </p>
          ) : null}
          {outstandingBills.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {pendingEntryBills.length > 0
                ? 'No checkout bills awaiting payment.'
                : 'No outstanding balance on this company.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="py-2.5 px-4 font-medium">Date</th>
                    <th className="py-2.5 px-4 font-medium">Guest</th>
                    <th className="py-2.5 px-4 font-medium">Room</th>
                    <th className="py-2.5 px-4 font-medium text-right">Total</th>
                    <th className="py-2.5 px-4 font-medium text-right">Paid</th>
                    <th className="py-2.5 px-4 font-medium text-right">Due</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingBills.map((bill) => (
                    <tr key={bill.id} className="border-b last:border-0">
                      <td className="py-3 px-4">
                        {format(new Date(bill.billedAt), 'dd/MM/yyyy')}
                      </td>
                      <td className="py-3 px-4">{bill.guestName}</td>
                      <td className="py-3 px-4">{bill.roomNumber || '—'}</td>
                      <td className="py-3 px-4 text-right">{formatBdt(bill.totalAmount)}</td>
                      <td className="py-3 px-4 text-right text-emerald-700">
                        {formatBdt(bill.paidAmount)}
                      </td>
                      <td className="py-3 px-4 text-right text-red-600 font-medium">
                        {formatBdt(bill.dueAmount)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          {bill.invoiceId && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                window.open(
                                  `/invoice/${bill.invoiceId}`,
                                  '_blank',
                                  'noopener,noreferrer'
                                )
                              }
                            >
                              Invoice
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => openPayDialog(bill)}
                          >
                            Receive payment
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
                Guest: <strong className="text-foreground">{payBill.guestName}</strong>
                {payBill.roomNumber ? ` · Room ${payBill.roomNumber}` : ''}
              </p>
              <p className="text-sm text-muted-foreground">
                Due: <strong className="text-foreground">{formatBdt(payBill.dueAmount)}</strong>
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
