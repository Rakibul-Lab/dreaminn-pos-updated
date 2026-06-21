'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { StatusBadge } from '../shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Search, LogIn, LogOut, XCircle, Receipt, FileText, FilePenLine, CalendarRange, FileSpreadsheet, FileDown, Loader2, CreditCard, IdCard, ArrowRightLeft, Eye, UtensilsCrossed, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BookingIdUploadDialog } from './BookingIdUploadDialog';
import { BookingAddPaymentDialog } from './BookingAddPaymentDialog';
import { BookingRestaurantBillDialog } from './BookingRestaurantBillDialog';
import { openNewReservationTab, openRegistrationFormTab } from '@/lib/reservation-navigation';
import { openCheckoutTab } from '@/lib/checkout-navigation';
import { formatBdt } from '@/lib/currency';
import { getPaginationPages } from '@/lib/pagination-pages';
import { cn } from '@/lib/utils';
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method';
import { computeRefundFromInput, computeBookingDisplayVat, resolveBookingVatListDisplay } from '@/lib/booking-totals';
import { Switch } from '@/components/ui/switch';
import { useHotelTimes } from '@/hooks/use-hotel-times';
import { useAuthStore } from '@/lib/auth-store';
import {
  formatListBookingCheckIn,
  formatListBookingCheckOut,
  getListBookingCheckInParts,
  getListBookingCheckOutParts,
} from '@/lib/hotel-times';
import {
  BOOKING_DATE_PRESET_OPTIONS,
  buildBookingsExportFilterLabels,
  formatBookingDateFilterLabel,
  resolveBookingDateRangeWithBusinessDate,
  type BookingDatePreset,
} from '@/lib/booking-date-filter';
import { useBusinessDate } from '@/hooks/use-business-date';
import { canBookingCheckIn } from '@/lib/reservation-completion-fields';
import {
  buildBookingsExportQuery,
  downloadBookingsExcel,
  downloadBookingsPdf,
} from '@/lib/bookings-export';
import { getBookingSourceLabel, isWalkInBooking } from '@/lib/booking-company';
import { formatBookingListDiscount } from '@/lib/booking-discount';
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration';
import { ReservationEntryConvertDialog } from './ReservationEntryConvertDialog';
import { ReservationEntryDetailsDialog } from './ReservationEntryDetailsDialog';

interface Booking {
  id: string;
  confirmationNumber?: string | null;
  customerId: string;
  roomId: string;
  status: 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  isInitialReservation?: boolean;
  isCorporateGuest?: boolean;
  nidPhysicallyReceived?: boolean;
  idDocumentCount?: number;
  checkIn: string;
  checkOut: string;
  actualCheckIn?: string | null;
  actualCheckOut?: string | null;
  adults: number;
  children: number;
  totalRoomCharge: number;
  advancePayment: number;
  initialPayment?: number;
  dueAmount: number;
  vatApplied?: boolean | null;
  vatPercent?: number;
  vatAmount?: number;
  serviceChargePercent?: number | null;
  totalWithVat?: number;
  discountEnabled?: boolean;
  discountType?: string | null;
  discountValue?: number;
  discountAmount?: number;
  notes?: string | null;
  createdAt?: string;
  company?: string | null;
  companyLedgerId?: string | null;
  companyLedger?: { id: string; name: string } | null;
  companyLedgerGuest?: { registrationNumber?: string | null } | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    address?: string | null;
    nationality?: string | null;
    idType?: string | null;
    idNumber?: string | null;
    registrationNumber?: string | null;
    company?: string | null;
    designation?: string | null;
  };
  room: { id: string; roomNumber: string; totalPrice: number; type: { name: string } };
}

type ReservationEntryRow = {
  id: string;
  recordType: 'reservation_entry';
  status: 'RESERVED_ENTRY' | 'RESERVED_ENTRY_PARTIAL' | 'RESERVED_ENTRY_FULFILLED';
  entryStatus: 'ACTIVE' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
  checkIn: string;
  checkOut: string;
  guestName: string | null;
  guestPhone: string | null;
  guestAddress: string | null;
  registrationNumber?: string | null;
  confirmationNumber?: string | null;
  guestRegistrationNumber?: string | null;
  company: string | null;
  companyLedgerId: string | null;
  companyLedger?: { id: string; name: string } | null;
  totalAmount: number;
  advancePayment: number;
  dueAmount: number;
  notes: string | null;
  createdAt: string;
  lineSummary: string;
  totalRooms: number;
  unfulfilledRooms: number;
  creator: { id: string; name: string };
  convertedBookings?: Array<{ id: string; confirmationNumber: string | null; roomNumber: string }>;
  lines: Array<{
    roomTypeName: string;
    roomNumber: string | null;
    quantity: number;
    unfulfilledCount?: number;
  }>;
};

type BookingListItem =
  | (Booking & { recordType?: 'booking' })
  | ReservationEntryRow;

interface CancelPreview {
  bookingId: string;
  customerName: string;
  roomNumber: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
  bookedNights?: number;
  maxRefundable: number;
  totalWithVat: number;
  dueAmount: number;
}

function isReservationEntryRow(item: BookingListItem): item is ReservationEntryRow {
  return item.recordType === 'reservation_entry' || item.status.startsWith('RESERVED_ENTRY');
}

function BookingDatetimeCell({ date, time }: { date: string; time: string }) {
  return (
    <>
      <p className="bl-truncate font-medium">{date}</p>
      <p className="bl-truncate bl-secondary text-muted-foreground">{time}</p>
    </>
  );
}

/** Shorter booking-column labels so badges fit without overlapping the next column. */
function bookingListStatusLabel(status: string): string | undefined {
  switch (status) {
    case 'RESERVED_ENTRY':
      return 'Res. entry';
    case 'RESERVED_ENTRY_PARTIAL':
      return 'Partial entry';
    case 'RESERVED_ENTRY_FULFILLED':
      return 'Fulfilled';
    default:
      return undefined;
  }
}

function bookingListStatusTitle(status: string): string | undefined {
  switch (status) {
    case 'RESERVED_ENTRY':
      return 'Reserved entry';
    case 'RESERVED_ENTRY_PARTIAL':
      return 'Entry (partial)';
    case 'RESERVED_ENTRY_FULFILLED':
      return 'Entry fulfilled';
    default:
      return undefined;
  }
}

function formatReservationEntryLineLabel(line: ReservationEntryRow['lines'][number]) {
  if (line.roomNumber) {
    return `${line.roomTypeName} · ${line.roomNumber}`;
  }
  return line.quantity > 1 ? `${line.quantity}× ${line.roomTypeName}` : line.roomTypeName;
}

function formatReservationEntryLineName(line: ReservationEntryRow['lines'][number]) {
  if (line.roomNumber) {
    return `${line.roomTypeName} · ${line.roomNumber}`;
  }
  return line.roomTypeName;
}

function reservationEntryLineQuantity(line: ReservationEntryRow['lines'][number]) {
  return line.roomNumber ? 1 : Math.max(1, line.quantity);
}

function BookingListRoomCell({ item }: { item: ReservationEntryRow }) {
  const lines = item.lines ?? [];
  const showDropdown = item.totalRooms > 1 || lines.length > 1;

  if (!showDropdown) {
    const line = lines[0];
    if (line) {
      return (
        <>
          <p className="bl-truncate font-medium" title={line.roomNumber ?? line.roomTypeName}>
            {line.roomNumber ?? line.roomTypeName}
          </p>
          <p
            className="bl-truncate bl-secondary text-muted-foreground"
            title={line.roomNumber ? line.roomTypeName : undefined}
          >
            {line.roomNumber ? line.roomTypeName : 'Category hold'}
          </p>
        </>
      );
    }
    return (
      <>
        <p className="bl-truncate font-medium" title={item.lineSummary}>
          {item.lineSummary || '—'}
        </p>
        <p className="bl-truncate bl-secondary text-muted-foreground">1 room</p>
      </>
    );
  }

  const summaryTitle = lines.map(formatReservationEntryLineLabel).join(', ');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex max-w-full items-center gap-1 rounded-md text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={summaryTitle}
        >
          <span className="min-w-0">
            <span className="bl-truncate block font-medium">
              {item.totalRooms} room{item.totalRooms === 1 ? '' : 's'}
            </span>
            <span className="bl-truncate bl-secondary block text-muted-foreground">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Room lines
          </p>
          <p className="text-xs font-semibold text-foreground">
            {item.totalRooms} room{item.totalRooms === 1 ? '' : 's'} total
          </p>
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
          {lines.map((line, index) => {
            const qty = reservationEntryLineQuantity(line);
            return (
            <li
              key={`${line.roomTypeName}-${line.roomNumber ?? 'cat'}-${index}`}
              className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-muted/80"
            >
              <span className="min-w-0 font-medium">{formatReservationEntryLineName(line)}</span>
              <span className="shrink-0 tabular-nums text-xs font-semibold text-muted-foreground">
                ×{qty}
              </span>
            </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function BookingsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { times, formatCheckIn, formatCheckOut } = useHotelTimes();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [entryScopeFilter, setEntryScopeFilter] = useState<'business_day' | 'all'>('business_day');
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Check-in dialog state
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [checkInBookingId, setCheckInBookingId] = useState<string | null>(null);
  const [checkInPayment, setCheckInPayment] = useState('0');
  const [checkInPaymentMethod, setCheckInPaymentMethod] = useState('CASH');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBookingId, setCancelBookingId] = useState<string | null>(null);
  const [refundEnabled, setRefundEnabled] = useState(false);
  const [refundMode, setRefundMode] = useState<'percent' | 'amount'>('percent');
  const [refundPercent, setRefundPercent] = useState('100');
  const [refundAmount, setRefundAmount] = useState('0');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [cancelReason, setCancelReason] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [idUploadBookingId, setIdUploadBookingId] = useState<string | null>(null);
  const [idUploadDialogOpen, setIdUploadDialogOpen] = useState(false);
  const [addPaymentBookingId, setAddPaymentBookingId] = useState<string | null>(null);
  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [restaurantBillBookingId, setRestaurantBillBookingId] = useState<string | null>(null);
  const [restaurantBillDialogOpen, setRestaurantBillDialogOpen] = useState(false);
  const [convertEntryId, setConvertEntryId] = useState<string | null>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [detailsEntryId, setDetailsEntryId] = useState<string | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data: businessDateRes } = useBusinessDate();
  const businessDate = businessDateRes?.data?.businessDate;

  const handleNewReservation = () => {
    openNewReservationTab();
  };

  const handleOpenCheckIn = (bookingId: string) => {
    setCheckInBookingId(bookingId);
    setCheckInDialogOpen(true);
  };

  const dateRange = useMemo(
    () => resolveBookingDateRangeWithBusinessDate(datePreset, customDateFrom, customDateTo, businessDate),
    [datePreset, customDateFrom, customDateTo, businessDate]
  );

  const buildQuery = () => {
    const params: string[] = [`page=${page}`, `limit=${pageSize}`];
    if (statusFilter !== 'all' && statusFilter !== 'RESERVED_ENTRY') {
      params.push(`status=${statusFilter}`);
    }
    if (searchQuery) params.push(`search=${encodeURIComponent(searchQuery)}`);
    if (statusFilter === 'RESERVED_ENTRY') {
      params.push(`scope=${entryScopeFilter}`);
      if (entryScopeFilter === 'business_day' && businessDate) {
        params.push(`businessDate=${encodeURIComponent(businessDate)}`);
      }
      return `/reservation-entries?${params.join('&')}`;
    }
    if (dateRange.dateFrom) params.push(`dateFrom=${dateRange.dateFrom}`);
    if (dateRange.dateTo) params.push(`dateTo=${dateRange.dateTo}`);
    return `/bookings?${params.join('&')}`;
  };

  const isReservationEntryList = statusFilter === 'RESERVED_ENTRY';

  const needsBusinessDate =
    (datePreset === 'today' || datePreset === 'yesterday') ||
    (isReservationEntryList && entryScopeFilter === 'business_day');
  const businessDateReady = !needsBusinessDate || !!businessDate;

  const { data: bookingsData, isLoading } = useQuery({
    queryKey: ['bookings', statusFilter, entryScopeFilter, datePreset, customDateFrom, customDateTo, businessDate, page, pageSize, searchQuery],
    queryFn: () =>
      api.get<{ success: boolean; data: BookingListItem[]; meta: { total: number; page: number; totalPages: number } }>(
        buildQuery()
      ),
    enabled: businessDateReady,
  });

  const { data: cancelPreviewData, isLoading: cancelPreviewLoading } = useQuery({
    queryKey: ['cancel-preview', cancelBookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: CancelPreview }>(`/bookings/cancel/${cancelBookingId}`),
    enabled: !!cancelBookingId && cancelDialogOpen,
  });

  const bookings = ((bookingsData as any)?.data || []) as BookingListItem[];
  const totalBookings = (bookingsData as any)?.meta?.total || 0;
  const totalPages = Math.max((bookingsData as any)?.meta?.totalPages || 1, 1);
  const rangeStart = totalBookings === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalBookings);
  const pageNumbers = getPaginationPages(page, totalPages);

  const checkInMutation = useMutation({
    mutationFn: ({ id, initialPayment, paymentMethod }: { id: string; initialPayment: number; paymentMethod: string }) =>
      api.post(`/bookings/check-in/${id}`, { initialPayment, paymentMethod }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to check in');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['available-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Guest checked in successfully');
      setCheckInDialogOpen(false);
      setCheckInBookingId(null);
      setCheckInPayment('0');
      setCheckInPaymentMethod('CASH');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to check in');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      refundEnabled: boolean;
      refundMode: 'percent' | 'amount';
      refundPercent: number;
      refundAmount: number;
      refundMethod: string;
      reason?: string;
    }) =>
      api.post(`/bookings/cancel/${payload.id}`, {
        refundEnabled: payload.refundEnabled,
        refundMode: payload.refundMode,
        refundPercent: payload.refundPercent,
        refundAmount: payload.refundAmount,
        refundMethod: payload.refundMethod,
        reason: payload.reason,
      }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to cancel reservation');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['available-rooms'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast.success(res.message || 'Reservation cancelled');
      setCancelDialogOpen(false);
      setCancelBookingId(null);
      setRefundEnabled(false);
      setRefundMode('percent');
      setRefundPercent('100');
      setRefundAmount('0');
      setRefundMethod('CASH');
      setCancelReason('');
    },
    onError: () => toast.error('Failed to cancel reservation'),
  });

  const cancelEntryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/reservation-entries/${id}`, { action: 'cancel' }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to cancel reservation entry');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['reservation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Reservation entry cancelled');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel reservation entry');
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (bookingId: string) => api.post('/invoices', { bookingId }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to generate invoice');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      const invoiceId = res?.data?.id;
      if (invoiceId) {
        window.open(`/invoice/${invoiceId}`, '_blank', 'noopener,noreferrer');
      }
      toast.success('Invoice generated successfully');
    },
    onError: () => toast.error('Failed to generate invoice'),
  });

  const cancelPreview = (cancelPreviewData as any)?.data as CancelPreview | undefined;
  const maxRefundable = cancelPreview?.maxRefundable ?? 0;
  const computedRefundTotal = useMemo(() => {
    if (!refundEnabled || maxRefundable <= 0) return 0;
    return computeRefundFromInput(
      maxRefundable,
      refundMode,
      parseFloat(refundPercent) || 0,
      parseFloat(refundAmount) || 0
    );
  }, [refundEnabled, maxRefundable, refundMode, refundPercent, refundAmount]);

  const openCancelDialog = (bookingId: string) => {
    setCancelBookingId(bookingId);
    setRefundEnabled(false);
    setRefundMode('percent');
    setRefundPercent('100');
    setRefundAmount('0');
    setRefundMethod('CASH');
    setCancelReason('');
    setCancelDialogOpen(true);
  };

  const buildExportMeta = () => ({
    filters: buildBookingsExportFilterLabels({
      datePreset,
      customDateFrom,
      customDateTo,
      status: statusFilter,
      search: searchQuery,
    }),
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email, role: user.role }
      : undefined,
  });

  const fetchBookingsForExport = async () => {
    const url = buildBookingsExportQuery({
      status: statusFilter,
      search: searchQuery,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    });
    const res = await api.get<{ success: boolean; data: Booking[]; meta?: { total: number } }>(url);
    if (!res?.success) {
      throw new Error('Failed to fetch reservations for export');
    }
    return res.data ?? [];
  };

  const handleExportExcel = async () => {
    setExporting('excel');
    const toastId = toast.loading('Preparing Excel export…');
    try {
      const rows = await fetchBookingsForExport();
      if (!rows.length) {
        toast.error('No reservations match the current filters', { id: toastId });
        return;
      }
      await downloadBookingsExcel(rows, times, buildExportMeta());
      toast.success(`Exported ${rows.length} reservation(s) to Excel`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    setExporting('pdf');
    const toastId = toast.loading('Preparing PDF export…');
    try {
      const rows = await fetchBookingsForExport();
      if (!rows.length) {
        toast.error('No reservations match the current filters', { id: toastId });
        return;
      }
      await downloadBookingsPdf(rows, times, buildExportMeta());
      toast.success(`Exported ${rows.length} reservation(s) to PDF`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Bookings</h2>
          <p className="text-sm text-muted-foreground">
            {datePreset === 'today' && businessDate
              ? `${totalBookings} for business day ${businessDate} — expected arrivals & in-house guests`
              : `${totalBookings} reservations · ${formatBookingDateFilterLabel(datePreset, customDateFrom, customDateTo)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleExportExcel()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'excel' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleExportPdf()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'pdf' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Export PDF
          </Button>
          <Button variant="outline" onClick={openRegistrationFormTab}>
            <FileText className="w-4 h-4 mr-2" />
            Registration Form
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleNewReservation}
          >
            <Plus className="w-4 h-4 mr-2" />
            New Reservation
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search guest, phone, reg. no., or room..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="RESERVED">Reserved</SelectItem>
            <SelectItem value="RESERVED_ENTRY">Reserved entry</SelectItem>
            <SelectItem value="CHECKED_IN">Checked In</SelectItem>
            <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="COMPANY">Company</SelectItem>
          </SelectContent>
        </Select>
        {isReservationEntryList ? (
          <Select
            value={entryScopeFilter}
            onValueChange={(v) => {
              setEntryScopeFilter(v as 'business_day' | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business_day">Business day</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        ) : (
        <Select
          value={datePreset}
          onValueChange={(v) => {
            setDatePreset(v as BookingDatePreset);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Date" />
          </SelectTrigger>
          <SelectContent>
            {BOOKING_DATE_PRESET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}
        {!isReservationEntryList && datePreset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="booking-date-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="booking-date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => {
                  setCustomDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-date-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="booking-date-to"
                type="date"
                value={customDateTo}
                min={customDateFrom || undefined}
                onChange={(e) => {
                  setCustomDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              />
            </div>
          </>
        )}
      </div>

      {/* Bookings Table */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: pageSize }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
            <table className="bookings-sticky-table bookings-list-table w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="col-guest text-left font-medium">Guest</th>
                  <th className="col-room text-left font-medium">Room</th>
                  <th className="col-regno text-left font-medium">Reg. No.</th>
                  <th className="col-checkin text-left font-medium">Check-in</th>
                  <th className="col-checkout text-left font-medium">Check-out</th>
                  <th className="col-booking text-left font-medium">Booking</th>
                  <th className="col-company text-left font-medium">Company</th>
                  <th className="col-discount text-right font-medium">Discount</th>
                  <th className="col-vat text-right font-medium" title="VAT amount and rate">VAT</th>
                  <th className="col-total text-right font-medium" title="Total including VAT">Total</th>
                  <th className="col-due text-right font-medium" title="Balance due including VAT">Due</th>
                  <th className="col-actions text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-background">
              {bookings.map((item) => {
                if (isReservationEntryRow(item)) {
                  return (
                    <tr key={item.id} className="border-b border-border/60 hover:bg-muted/40">
                      <td className="col-guest">
                        <p className="bl-truncate font-medium" title={item.guestName ?? undefined}>
                          {item.guestName || 'Reservation entry'}
                        </p>
                        <p className="bl-truncate bl-secondary text-muted-foreground" title={item.guestPhone ?? undefined}>
                          {item.guestPhone || item.creator.name}
                        </p>
                      </td>
                      <td className="col-room">
                        <BookingListRoomCell item={item} />
                      </td>
                      <td className="col-regno">
                        <p
                          className="bl-truncate font-medium font-mono text-xs"
                          title={
                            item.registrationNumber ?? item.guestRegistrationNumber ?? undefined
                          }
                        >
                          {item.registrationNumber ?? item.guestRegistrationNumber ?? '—'}
                        </p>
                      </td>
                      <td className="col-checkin" title={formatListBookingCheckIn(item, times)}>
                        <BookingDatetimeCell {...getListBookingCheckInParts(item, times, true)} />
                      </td>
                      <td className="col-checkout" title={formatListBookingCheckOut(item, times)}>
                        <BookingDatetimeCell {...getListBookingCheckOutParts(item, times, true)} />
                      </td>
                      <td className="col-booking">
                        <div className="bl-booking-stack">
                          <StatusBadge
                            status={item.status}
                            label={bookingListStatusLabel(item.status)}
                            title={bookingListStatusTitle(item.status)}
                            className="text-xs px-2 py-0.5 h-6 font-normal max-w-full"
                          />
                          {item.confirmationNumber ? (
                            <p
                              className="bl-truncate bl-secondary text-muted-foreground font-mono text-[11px] leading-tight"
                              title={item.confirmationNumber}
                            >
                              {item.confirmationNumber}
                            </p>
                          ) : null}
                          {(item.convertedBookings?.length ?? 0) > 0 ? (
                            <p
                              className="bl-truncate bl-secondary text-muted-foreground text-[11px] leading-tight"
                              title={item.convertedBookings?.map((b) => b.confirmationNumber ?? b.roomNumber).join(', ')}
                            >
                              {item.convertedBookings!.length} booking{item.convertedBookings!.length === 1 ? '' : 's'}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="col-company">
                        {item.companyLedgerId || (item.company && item.company !== 'Direct/Walk in') ? (
                          <StatusBadge
                            status="COMPANY"
                            label={item.companyLedger?.name ?? item.company ?? 'Company'}
                            className="bl-source-badge text-xs px-2 py-0.5 h-6 font-normal"
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="col-discount text-right text-muted-foreground">—</td>
                      <td className="col-vat text-muted-foreground">—</td>
                      <td className="col-total font-medium">
                        {item.totalAmount > 0 ? formatBdt(item.totalAmount) : '—'}
                      </td>
                      <td className="col-due text-right">
                        {item.dueAmount > 0 ? (
                          <span className="text-red-600 font-medium">{formatBdt(item.dueAmount)}</span>
                        ) : (
                          <span className="text-emerald-600">—</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <div className="bl-actions">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            title="View details"
                            onClick={() => {
                              setDetailsEntryId(item.id);
                              setDetailsDialogOpen(true);
                            }}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0 border-sky-500 text-sky-700 hover:bg-sky-50"
                            title="Reservation entry confirmation"
                            onClick={() =>
                              window.open(`/reservation-entry/${item.id}`, '_blank', 'noopener,noreferrer')
                            }
                          >
                            <FileText className="w-3 h-3" />
                          </Button>
                          {(item.unfulfilledRooms ?? item.totalRooms) > 0 ? (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 shrink-0 border-violet-300 text-violet-700 hover:bg-violet-50"
                              title="Convert to booking"
                              onClick={() => {
                                setConvertEntryId(item.id);
                                setConvertDialogOpen(true);
                              }}
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-red-500 hover:text-red-600"
                            title="Cancel reservation entry"
                            disabled={cancelEntryMutation.isPending || (item.convertedBookings?.length ?? 0) > 0}
                            onClick={() => {
                              if (!window.confirm('Cancel this reservation entry and release blocked rooms?')) return;
                              cancelEntryMutation.mutate(item.id);
                            }}
                          >
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const booking = item as Booking;
                return (
                <tr key={booking.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="col-guest">
                    <p className="bl-truncate font-medium" title={booking.customer?.name}>
                      {booking.customer?.name}
                    </p>
                    <p className="bl-truncate bl-secondary text-muted-foreground" title={booking.customer?.phone ?? undefined}>
                      {booking.customer?.phone || '—'}
                    </p>
                  </td>
                  <td className="col-room">
                    <p className="bl-truncate font-medium" title={booking.room?.roomNumber}>
                      {booking.room?.roomNumber}
                    </p>
                    <p className="bl-truncate bl-secondary text-muted-foreground" title={booking.room?.type?.name}>
                      {booking.room?.type?.name}
                    </p>
                  </td>
                  <td className="col-regno">
                    <p
                      className="bl-truncate font-medium font-mono text-xs"
                      title={resolveBookingRegistrationNumber(booking) || undefined}
                    >
                      {resolveBookingRegistrationNumber(booking) || '—'}
                    </p>
                  </td>
                  <td className="col-checkin" title={formatListBookingCheckIn(booking, times)}>
                    <BookingDatetimeCell {...getListBookingCheckInParts(booking, times, true)} />
                  </td>
                  <td className="col-checkout" title={formatListBookingCheckOut(booking, times)}>
                    <BookingDatetimeCell {...getListBookingCheckOutParts(booking, times, true)} />
                  </td>
                  <td className="col-booking">
                    <div className="bl-booking-stack">
                      <StatusBadge
                        status={
                          booking.isInitialReservation && booking.status === 'RESERVED'
                            ? 'RESERVED_ND'
                            : booking.status
                        }
                        className="text-xs px-2 py-0.5 h-6 font-normal max-w-full"
                      />
                    </div>
                  </td>
                  <td className="col-company">
                    <StatusBadge
                      status={isWalkInBooking(booking) ? 'WALK_IN' : 'COMPANY'}
                      label={getBookingSourceLabel(booking)}
                      title={getBookingSourceLabel(booking)}
                      className="bl-source-badge text-xs px-2 py-0.5 h-6 font-normal"
                    />
                  </td>
                  <td className="col-discount text-right">
                    {(() => {
                      const discount = formatBookingListDiscount(booking);
                      if (discount.amount <= 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <>
                          <p className="font-medium">{formatBdt(discount.amount)}</p>
                          <p className="bl-secondary text-muted-foreground">{discount.label}</p>
                        </>
                      );
                    })()}
                  </td>
                  <td className="col-vat">
                    {(() => {
                      const vat = resolveBookingVatListDisplay(booking);
                      return (
                        <>
                          <p className="font-medium">{formatBdt(vat.amount)}</p>
                          <p className="bl-secondary text-muted-foreground">
                            {vat.percent}%
                            {vat.mode === 'included' ? ' incl.' : ''}
                          </p>
                        </>
                      );
                    })()}
                  </td>
                  <td className="col-total font-medium">
                    {formatBdt(booking.totalWithVat ?? booking.totalRoomCharge)}
                  </td>
                  <td className="col-due text-right">
                    <span className={booking.dueAmount > 0 ? 'text-red-600 font-medium' : 'text-emerald-600'}>
                      {formatBdt(booking.dueAmount)}
                    </span>
                  </td>
                  <td className="col-actions">
                    <div className="bl-actions">
                      {booking.status === 'RESERVED' && booking.isInitialReservation && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0 border-amber-500 text-amber-800 hover:bg-amber-50"
                          title="Edit initial reservation"
                          onClick={() =>
                            window.open(
                              `/reservations/${booking.id}/edit`,
                              '_blank',
                              'noopener,noreferrer'
                            )
                          }
                        >
                          <FilePenLine className="w-3 h-3" />
                        </Button>
                      )}
                      {booking.status === 'RESERVED' && (
                        <span
                          className="inline-flex"
                          title={
                            !canBookingCheckIn(booking, {
                              customer: booking.customer,
                              idDocumentCount: booking.idDocumentCount ?? 0,
                            })
                              ? booking.nidPhysicallyReceived
                                ? 'Complete required guest details before check-in'
                                : 'Complete the initial reservation (ID documents) using Edit before check-in'
                              : 'Check-in'
                          }
                        >
                          <Button
                            variant="outline"
                            size="icon"
                            className={`h-7 w-7 shrink-0 ${
                              !canBookingCheckIn(booking, {
                              customer: booking.customer,
                              idDocumentCount: booking.idDocumentCount ?? 0,
                            })
                                ? 'border-muted-foreground/30 text-muted-foreground'
                                : 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'
                            }`}
                            onClick={() => {
                              if (
                                !canBookingCheckIn(booking, {
                                  customer: booking.customer,
                                  idDocumentCount: booking.idDocumentCount ?? 0,
                                })
                              )
                                return;
                              setCheckInPayment('0');
                              setCheckInPaymentMethod('CASH');
                              handleOpenCheckIn(booking.id);
                            }}
                            disabled={
                              checkInMutation.isPending ||
                              !canBookingCheckIn(booking, {
                                customer: booking.customer,
                                idDocumentCount: booking.idDocumentCount ?? 0,
                              })
                            }
                          >
                            <LogIn className="w-3 h-3" />
                          </Button>
                        </span>
                      )}
                      {(booking.nidPhysicallyReceived === true || booking.isInitialReservation) &&
                        (booking.status === 'RESERVED' || booking.status === 'CHECKED_IN') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className={`h-7 w-7 shrink-0 ${
                              (booking.idDocumentCount ?? 0) > 0
                                ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'
                                : 'border-sky-500 text-sky-700 hover:bg-sky-50'
                            }`}
                            title={
                              (booking.idDocumentCount ?? 0) > 0
                                ? 'ID documents uploaded — update'
                                : 'Upload ID documents (required before checkout)'
                            }
                            onClick={() => {
                              setIdUploadBookingId(booking.id);
                              setIdUploadDialogOpen(true);
                            }}
                          >
                            <IdCard className="w-3 h-3" />
                          </Button>
                      )}
                      {booking.status === 'CHECKED_IN' && (
                        <>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0 border-orange-500 text-orange-700 hover:bg-orange-50"
                            title="Add restaurant bill"
                            onClick={() => {
                              setRestaurantBillBookingId(booking.id);
                              setRestaurantBillDialogOpen(true);
                            }}
                          >
                            <UtensilsCrossed className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0 border-violet-500 text-violet-700 hover:bg-violet-50"
                            title="Add payment"
                            onClick={() => {
                              setAddPaymentBookingId(booking.id);
                              setAddPaymentDialogOpen(true);
                            }}
                          >
                            <CreditCard className="w-3 h-3" />
                          </Button>
                          <span
                            className="inline-flex"
                            title={
                              !booking.isCorporateGuest &&
                              (booking.idDocumentCount ?? 0) === 0
                                ? 'Upload ID documents before checkout'
                                : 'Check-out'
                            }
                          >
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title="Check-out"
                              onClick={() => openCheckoutTab(booking.id)}
                              disabled={
                                !booking.isCorporateGuest &&
                                (booking.idDocumentCount ?? 0) === 0
                              }
                            >
                              <LogOut className="w-3 h-3" />
                            </Button>
                          </span>
                        </>
                      )}
                      {booking.status === 'RESERVED' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-red-500 hover:text-red-600"
                          onClick={() => openCancelDialog(booking.id)}
                          disabled={cancelMutation.isPending}
                          title="Cancel reservation"
                        >
                          <XCircle className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0 border-sky-500 text-sky-700 hover:bg-sky-50"
                        title="Reservation document"
                        onClick={() => window.open(`/reservation/${booking.id}`, '_blank', 'noopener,noreferrer')}
                      >
                        <FileText className="w-3 h-3" />
                      </Button>
                      {booking.status === 'CHECKED_OUT' && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0 border-amber-500 text-amber-700 hover:bg-amber-50"
                          title="Generate invoice"
                          onClick={() => generateInvoiceMutation.mutate(booking.id)}
                          disabled={generateInvoiceMutation.isPending}
                        >
                          <Receipt className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-muted-foreground">
                    {isReservationEntryList ? 'No reservation entries found' : 'No reservations found'}
                  </td>
                </tr>
              )}
              </tbody>
            </table>
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {totalBookings === 0
                ? 'No results'
                : `Showing ${rangeStart}–${rangeEnd} of ${totalBookings}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {pageNumbers.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="flex h-8 min-w-8 items-center justify-center px-1 text-sm text-muted-foreground"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-8 min-w-8 px-2',
                        item === page &&
                          'border-amber-600 bg-amber-600 text-white hover:bg-amber-700 hover:text-white'
                      )}
                      onClick={() => setPage(item)}
                      aria-current={item === page ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Check-in Payment Dialog */}
      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-emerald-600" />
              Check-in Guest
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="bg-muted/50">
              <CardContent className="p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Room charge</span>
                  <span className="font-medium">{formatBdt((() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.totalRoomCharge : 0;
                  })())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    VAT ({(() => {
                      const b = bookings.find(bk => bk.id === checkInBookingId);
                      if (!b) return 15;
                      return computeBookingDisplayVat(b).percent;
                    })()}%
                    {(() => {
                      const b = bookings.find(bk => bk.id === checkInBookingId);
                      if (b && computeBookingDisplayVat(b).mode === 'included') return ' incl.';
                      return '';
                    })()})
                  </span>
                  <span className="font-medium">{formatBdt((() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? computeBookingDisplayVat(b).amount : 0;
                  })())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total (incl. VAT)</span>
                  <span className="font-medium">{formatBdt((() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b?.totalWithVat ?? b?.totalRoomCharge ?? 0;
                  })())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Advance paid</span>
                  <span className="font-medium">{formatBdt((() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.advancePayment : 0;
                  })())}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span>Current due (incl. VAT)</span>
                  <span className="text-red-600">{formatBdt((() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.dueAmount : 0;
                  })())}</span>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2">
              <Label>Initial Payment at Check-in (BDT)</Label>
              <Input
                type="number"
                value={checkInPayment}
                onChange={(e) => setCheckInPayment(e.target.value)}
                placeholder="0"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Remaining due after payment: {formatBdt((() => {
                  const b = bookings.find(bk => bk.id === checkInBookingId);
                  const due = b ? b.dueAmount - (parseFloat(checkInPayment) || 0) : 0;
                  return Math.max(due, 0);
                })())}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={checkInPaymentMethod} onValueChange={setCheckInPaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={checkInMutation.isPending}
              onClick={() => {
                if (!checkInBookingId) return;
                checkInMutation.mutate({
                  id: checkInBookingId,
                  initialPayment: parseFloat(checkInPayment) || 0,
                  paymentMethod: checkInPaymentMethod,
                });
              }}
            >
              {checkInMutation.isPending ? 'Checking in...' : 'Confirm Check-in'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingIdUploadDialog
        bookingId={idUploadBookingId}
        open={idUploadDialogOpen}
        onOpenChange={(open) => {
          setIdUploadDialogOpen(open);
          if (!open) setIdUploadBookingId(null);
        }}
      />

      <BookingAddPaymentDialog
        bookingId={addPaymentBookingId}
        open={addPaymentDialogOpen}
        onOpenChange={(open) => {
          setAddPaymentDialogOpen(open);
          if (!open) setAddPaymentBookingId(null);
        }}
      />

      <BookingRestaurantBillDialog
        bookingId={restaurantBillBookingId}
        guestLabel={(() => {
          const row = bookings.find((b) => b.id === restaurantBillBookingId);
          return row && !isReservationEntryRow(row) ? row.customer.name : undefined;
        })()}
        roomNumber={(() => {
          const row = bookings.find((b) => b.id === restaurantBillBookingId);
          return row && !isReservationEntryRow(row) ? row.room.roomNumber : undefined;
        })()}
        open={restaurantBillDialogOpen}
        onOpenChange={(open) => {
          setRestaurantBillDialogOpen(open);
          if (!open) setRestaurantBillBookingId(null);
        }}
      />

      <ReservationEntryConvertDialog
        entryId={convertEntryId}
        open={convertDialogOpen}
        onOpenChange={(open) => {
          setConvertDialogOpen(open);
          if (!open) setConvertEntryId(null);
        }}
      />

      <ReservationEntryDetailsDialog
        entryId={detailsEntryId}
        open={detailsDialogOpen}
        onOpenChange={(open) => {
          setDetailsDialogOpen(open);
          if (!open) setDetailsEntryId(null);
        }}
      />

      {/* Cancel reservation */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5 shrink-0" />
              Cancel reservation
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {cancelPreviewLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : cancelPreview ? (
              <Card className="gap-0 border-border bg-muted/50 py-0 shadow-none">
                <CardContent className="space-y-1 p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Guest</span>
                    <span className="text-right font-medium">{cancelPreview.customerName}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Room</span>
                    <span className="font-medium">{cancelPreview.roomNumber}</span>
                  </div>
                  {cancelPreview.bookedNights != null && (
                    <>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Reserved nights</span>
                        <span className="font-medium">{cancelPreview.bookedNights} night(s)</span>
                      </div>
                      {cancelPreview.checkIn && cancelPreview.checkOut && (
                        <div className="flex justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Reservation dates</span>
                          <span className="text-right text-xs font-medium">
                            {formatCheckIn(cancelPreview.checkIn)} →{' '}
                            {formatCheckOut(cancelPreview.checkOut)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Paid (refundable)</span>
                    <span className="font-medium text-emerald-700">
                      {formatBdt(cancelPreview.maxRefundable)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Why is this reservation being cancelled?"
                rows={2}
                className="w-full resize-none"
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Issue refund</p>
                  <p className="text-xs text-muted-foreground">
                    Off by default — no refund unless you turn this on
                  </p>
                </div>
                <Switch
                  className="mt-0.5 shrink-0"
                  checked={refundEnabled}
                  onCheckedChange={(checked) => {
                    setRefundEnabled(checked);
                    if (checked && maxRefundable > 0) {
                      setRefundAmount(String(maxRefundable));
                    }
                  }}
                  disabled={maxRefundable <= 0}
                />
              </div>

              {refundEnabled && maxRefundable > 0 && (
                <div className="space-y-3 border-t border-amber-200/60 bg-amber-50/40 p-3 dark:bg-amber-950/20">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={refundMode === 'percent' ? 'default' : 'outline'}
                      className={refundMode === 'percent' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                      onClick={() => setRefundMode('percent')}
                    >
                      By %
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={refundMode === 'amount' ? 'default' : 'outline'}
                      className={refundMode === 'amount' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                      onClick={() => setRefundMode('amount')}
                    >
                      By amount
                    </Button>
                  </div>

                  {refundMode === 'percent' ? (
                    <div className="space-y-2">
                      <Label htmlFor="refund-percent">Refund percentage</Label>
                      <Input
                        id="refund-percent"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={refundPercent}
                        onChange={(e) => setRefundPercent(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="refund-amount">Refund amount (BDT)</Label>
                      <Input
                        id="refund-amount"
                        type="number"
                        min={0}
                        max={maxRefundable}
                        step={0.01}
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        className="w-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        Maximum: {formatBdt(maxRefundable)}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Refund method</Label>
                    <Select value={refundMethod} onValueChange={setRefundMethod}>
                      <SelectTrigger className="w-full">
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

                  <p className="border-t border-amber-200/60 pt-2 text-sm font-semibold text-foreground">
                    Refund total:{' '}
                    <span className="text-amber-700">{formatBdt(computedRefundTotal)}</span>
                  </p>
                </div>
              )}

              {refundEnabled && maxRefundable <= 0 && (
                <p className="border-t border-border px-3 pb-3 text-xs text-muted-foreground">
                  No payments on this reservation — refund is not available.
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep reservation
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending || !cancelBookingId}
              onClick={() => {
                if (!cancelBookingId) return;
                if (refundEnabled && computedRefundTotal <= 0) {
                  toast.error('Enter a valid refund amount or turn off refund.');
                  return;
                }
                cancelMutation.mutate({
                  id: cancelBookingId,
                  refundEnabled,
                  refundMode,
                  refundPercent: parseFloat(refundPercent) || 0,
                  refundAmount: parseFloat(refundAmount) || 0,
                  refundMethod,
                  reason: cancelReason.trim() || undefined,
                });
              }}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Confirm cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
