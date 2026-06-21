'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FileText,
  History,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Receipt,
  CalendarRange,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { StatusBadge } from '../shared/StatusBadge';
import { formatBdt } from '@/lib/currency';
import { formatGuestId } from '@/lib/id-type-label';
import { formatListBookingCheckIn, formatListBookingCheckOut } from '@/lib/hotel-times';
import { useHotelTimes } from '@/hooks/use-hotel-times';
import { formatConfirmationNumber } from '@/lib/confirmation-number';
import { formatInvoiceNumberDisplay } from '@/lib/invoice-number';
import { formatPaymentMethod } from '@/lib/payment-method';
import { downloadGuestHistoryPdf } from '@/lib/guest-history-export';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type HistoryStay = {
  booking: {
    id: string;
    confirmationNumber?: string | null;
    registrationNumber?: string | null;
    status: string;
    checkIn: string;
    checkOut: string;
    actualCheckIn?: string | null;
    actualCheckOut?: string | null;
    totalRoomCharge: number;
    totalWithVat: number;
    dueAmount: number;
    paidAmount: number;
    room: { roomNumber: string; type: { name: string } };
  };
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

type GuestHistoryPayload = {
  guest: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    nationality?: string | null;
    address?: string | null;
    idType?: string | null;
    idNumber?: string | null;
    notes?: string | null;
  };
  stays: HistoryStay[];
  totalDue: number;
  stayCount: number;
};

type HistoryDateFilter = 'all' | 'custom';

function formatPaymentType(type: string): string {
  return type.replace(/_/g, ' ');
}

interface GuestHistoryDialogProps {
  customerId: string | null;
  highlightRegistrationNumber?: string;
  onClose: () => void;
}

export function GuestHistoryDialog({
  customerId,
  highlightRegistrationNumber,
  onClose,
}: GuestHistoryDialogProps) {
  const { times } = useHotelTimes();
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [expandedStays, setExpandedStays] = useState<Record<string, boolean>>({});
  const [exportingPdf, setExportingPdf] = useState(false);

  const historyQueryKey = useMemo(
    () => ['customer-guest-history', customerId, dateFilter, customDateFrom, customDateTo],
    [customerId, dateFilter, customDateFrom, customDateTo]
  );

  const historyUrl = useMemo(() => {
    if (!customerId) return '';
    const params: string[] = [];
    if (dateFilter === 'custom') {
      if (customDateFrom) params.push(`dateFrom=${encodeURIComponent(customDateFrom)}`);
      if (customDateTo) params.push(`dateTo=${encodeURIComponent(customDateTo)}`);
    }
    const qs = params.length ? `?${params.join('&')}` : '';
    return `/customers/${customerId}/history${qs}`;
  }, [customerId, dateFilter, customDateFrom, customDateTo]);

  const { data, isLoading, isError } = useQuery({
    queryKey: historyQueryKey,
    queryFn: () =>
      api.get<{ success: boolean; data: GuestHistoryPayload }>(historyUrl),
    enabled: !!customerId,
  });

  const history = data?.data;
  const open = !!customerId;

  useEffect(() => {
    if (!history?.stays.length || !highlightRegistrationNumber?.trim()) return;
    const search = highlightRegistrationNumber.trim();
    const toExpand: Record<string, boolean> = {};
    for (const stay of history.stays) {
      const regNo = stay.booking.registrationNumber?.trim() || '';
      if (regNo.includes(search)) {
        toExpand[stay.booking.id] = true;
      }
    }
    if (Object.keys(toExpand).length > 0) {
      setExpandedStays((prev) => ({ ...prev, ...toExpand }));
    }
  }, [history, highlightRegistrationNumber]);

  const handleExportPdf = async () => {
    if (!history?.guest) return;
    setExportingPdf(true);
    const toastId = toast.loading('Generating PDF…');
    try {
      const bookings = history.stays.map((stay) => ({
        id: stay.booking.id,
        confirmationNumber: stay.booking.confirmationNumber,
        registrationNumber: stay.booking.registrationNumber,
        status: stay.booking.status,
        checkIn: stay.booking.checkIn,
        checkOut: stay.booking.checkOut,
        actualCheckIn: stay.booking.actualCheckIn,
        actualCheckOut: stay.booking.actualCheckOut,
        totalRoomCharge: stay.booking.totalRoomCharge,
        totalWithVat: stay.booking.totalWithVat,
        dueAmount: stay.booking.dueAmount,
        room: stay.booking.room,
      }));
      await downloadGuestHistoryPdf(
        {
          name: history.guest.name,
          phone: history.guest.phone,
          email: history.guest.email,
          address: history.guest.address,
          nationality: history.guest.nationality,
          idType: history.guest.idType,
          idNumber: history.guest.idNumber,
        },
        bookings,
        times
      );
      toast.success('Guest history exported to PDF', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export PDF', { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDateFilter('all');
          setCustomDateFrom('');
          setCustomDateTo('');
          setExpandedStays({});
          onClose();
        }
      }}
    >
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] sm:max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-600" />
            Guest History
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : isError || !history ? (
            <p className="text-sm text-red-600 py-6 text-center">Failed to load guest history.</p>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <h3 className="text-lg font-semibold">{history.guest.name}</h3>
                <div className="grid gap-1.5 sm:grid-cols-2 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    {history.guest.phone}
                  </p>
                  {history.guest.email ? (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4 shrink-0" />
                      {history.guest.email}
                    </p>
                  ) : null}
                  {history.guest.address ? (
                    <p className="flex items-start gap-2 text-muted-foreground sm:col-span-2">
                      <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                      {history.guest.address}
                    </p>
                  ) : null}
                  {history.guest.nationality ? (
                    <p>
                      <span className="text-muted-foreground">Nationality: </span>
                      {history.guest.nationality}
                    </p>
                  ) : null}
                  {(history.guest.idType || history.guest.idNumber) && (
                    <p>
                      <span className="text-muted-foreground">ID: </span>
                      {formatGuestId(history.guest.idType, history.guest.idNumber)}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  {history.stayCount} total stay{history.stayCount === 1 ? '' : 's'}
                  {history.totalDue > 0 ? (
                    <>
                      {' '}
                      · Outstanding:{' '}
                      <span className="text-red-600 font-medium">{formatBdt(history.totalDue)}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Stay period</Label>
                  <Select
                    value={dateFilter}
                    onValueChange={(v) => setDateFilter(v as HistoryDateFilter)}
                  >
                    <SelectTrigger className="w-44 h-9">
                      <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stays</SelectItem>
                      <SelectItem value="custom">Custom date range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {dateFilter === 'custom' && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="gh-date-from" className="text-xs text-muted-foreground">
                        From
                      </Label>
                      <Input
                        id="gh-date-from"
                        type="date"
                        value={customDateFrom}
                        onChange={(e) => setCustomDateFrom(e.target.value)}
                        className="w-40 h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="gh-date-to" className="text-xs text-muted-foreground">
                        To
                      </Label>
                      <Input
                        id="gh-date-to"
                        type="date"
                        value={customDateTo}
                        min={customDateFrom || undefined}
                        onChange={(e) => setCustomDateTo(e.target.value)}
                        className="w-40 h-9"
                      />
                    </div>
                  </>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Stays & payment history
                  {dateFilter === 'custom' && (customDateFrom || customDateTo) ? (
                    <span className="font-normal text-muted-foreground ml-1">
                      ({history.stays.length} matching)
                    </span>
                  ) : null}
                </h4>

                {history.stays.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8 rounded-lg border bg-muted/20">
                    No stays match the selected period.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {history.stays.map((stay) => {
                      const b = stay.booking;
                      const isOpen = expandedStays[b.id] ?? false;
                      const regNo = b.registrationNumber?.trim() || '';
                      const isHighlighted =
                        !!highlightRegistrationNumber &&
                        !!regNo &&
                        regNo.includes(highlightRegistrationNumber.trim());
                      return (
                        <Collapsible
                          key={b.id}
                          open={isOpen}
                          onOpenChange={(nextOpen) =>
                            setExpandedStays((prev) => ({ ...prev, [b.id]: nextOpen }))
                          }
                          className={cn(
                            'rounded-lg border bg-card overflow-hidden',
                            isHighlighted && 'border-amber-500 ring-1 ring-amber-500/40'
                          )}
                        >
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                              )}
                              <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-[1fr_auto]">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">
                                      Room {b.room.roomNumber}
                                      <span className="text-muted-foreground font-normal">
                                        {' '}
                                        · {b.room.type.name}
                                      </span>
                                    </p>
                                    {regNo ? (
                                      <span className="text-xs font-mono font-semibold text-amber-800 bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 px-1.5 py-0.5 rounded">
                                        Reg. {regNo}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {formatListBookingCheckIn(b, times, true)} –{' '}
                                    {formatListBookingCheckOut(b, times, true)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatConfirmationNumber(b)}
                                  </p>
                                </div>
                                <div className="text-right space-y-1 sm:pt-0.5">
                                  <p className="font-medium">{formatBdt(b.totalWithVat)}</p>
                                  <StatusBadge status={b.status} className="text-xs" />
                                  {b.dueAmount > 0.009 ? (
                                    <p className="text-xs text-red-600">
                                      Due {formatBdt(b.dueAmount)}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t px-3 pb-3 pt-2 space-y-3 bg-muted/10">
                              {stay.invoice ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Invoice: </span>
                                    <span className="font-medium">
                                      {formatInvoiceNumberDisplay(stay.invoice.invoiceNumber)}
                                    </span>
                                    {stay.invoice.issuedAt ? (
                                      <span className="text-muted-foreground text-xs ml-2">
                                        {format(new Date(stay.invoice.issuedAt), 'dd MMM yyyy')}
                                      </span>
                                    ) : null}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    onClick={() =>
                                      window.open(
                                        `/invoice/${stay.invoice!.id}`,
                                        '_blank',
                                        'noopener,noreferrer'
                                      )
                                    }
                                  >
                                    <Receipt className="h-3.5 w-3.5" />
                                    Invoice
                                  </Button>
                                </div>
                              ) : null}

                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Payment history
                                  </p>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    onClick={() =>
                                      window.open(
                                        `/reservation/${b.id}`,
                                        '_blank',
                                        'noopener,noreferrer'
                                      )
                                    }
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    Reservation
                                  </Button>
                                </div>
                                {stay.payments.length === 0 ? (
                                  <p className="text-xs text-muted-foreground py-2">
                                    No payments recorded for this stay.
                                  </p>
                                ) : (
                                  <div className="rounded-md border overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                                          <th className="py-2 px-2 font-medium">Date</th>
                                          <th className="py-2 px-2 font-medium">Type</th>
                                          <th className="py-2 px-2 font-medium">Method</th>
                                          <th className="py-2 px-2 font-medium text-right">
                                            Amount
                                          </th>
                                          <th className="py-2 px-2 font-medium">Reference</th>
                                          <th className="py-2 px-2 font-medium">Received by</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {stay.payments.map((p) => (
                                          <tr key={p.id} className="border-b last:border-0">
                                            <td className="py-2 px-2 whitespace-nowrap">
                                              {format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm')}
                                            </td>
                                            <td className="py-2 px-2 capitalize">
                                              {formatPaymentType(p.paymentType)}
                                            </td>
                                            <td className="py-2 px-2">
                                              {formatPaymentMethod(p.method)}
                                            </td>
                                            <td className="py-2 px-2 text-right font-medium">
                                              {formatBdt(p.amount)}
                                            </td>
                                            <td className="py-2 px-2 text-muted-foreground">
                                              {p.reference || '—'}
                                            </td>
                                            <td className="py-2 px-2 text-muted-foreground">
                                              {p.receiver.name}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="bg-muted/30 font-medium">
                                          <td colSpan={3} className="py-2 px-2 text-right">
                                            Total paid
                                          </td>
                                          <td className="py-2 px-2 text-right">
                                            {formatBdt(b.paidAmount)}
                                          </td>
                                          <td colSpan={2} />
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2 sm:gap-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            onClick={() => void handleExportPdf()}
            disabled={!history || exportingPdf || isLoading}
          >
            {exportingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
