'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Phone,
  History,
  FileDown,
  Loader2,
  FileSpreadsheet,
  CalendarRange,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NationalityField } from '../shared/NationalityField';
import { getPaginationPages } from '@/lib/pagination-pages';
import { cn } from '@/lib/utils';
import { useHotelTimes } from '@/hooks/use-hotel-times';
import { formatGuestId, getIdTypeOptionsForNationality, DEFAULT_NATIONALITY, defaultIdTypeForNationality } from '@/lib/id-type-label';
import { formatListBookingCheckIn, formatListBookingCheckOut } from '@/lib/hotel-times';
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store';
import { GuestHistoryDialog } from './GuestHistoryDialog';
import {
  BOOKING_DATE_PRESET_OPTIONS,
  buildGuestsExportFilterLabels,
  resolveBookingDateRangeWithBusinessDate,
  type BookingDatePreset,
} from '@/lib/booking-date-filter';

const GUESTS_DATE_PRESET_OPTIONS: { value: BookingDatePreset; label: string }[] =
  BOOKING_DATE_PRESET_OPTIONS.map((opt) =>
    opt.value === 'today'
      ? { ...opt, label: 'Business today (incl. checked out)' }
      : opt
  );
import { useBusinessDate } from '@/hooks/use-business-date';
import {
  buildGuestsExportQuery,
  downloadGuestsExcel,
  downloadGuestsPdf,
  type GuestExportRecord,
} from '@/lib/guests-export';

interface GuestStay {
  checkIn: string;
  checkOut: string;
  actualCheckIn?: string | null;
  actualCheckOut?: string | null;
  status: string;
  roomNumber?: string | null;
}

interface Customer {
  id: string;
  name: string;
  email?: string | null;
  phone: string;
  address?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  nationality?: string | null;
  notes?: string | null;
  createdAt: string;
  source?: 'customer' | 'companion';
  historyCustomerId?: string | null;
  stay?: GuestStay | null;
}

export function CustomersPage() {
  const { times } = useHotelTimes();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = canAccessAdmin(user?.role);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data: businessDateRes } = useBusinessDate();
  const businessDate = businessDateRes?.data?.businessDate;

  const dateRange = useMemo(
    () => resolveBookingDateRangeWithBusinessDate(datePreset, customDateFrom, customDateTo, businessDate),
    [datePreset, customDateFrom, customDateTo, businessDate]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null);
  const [historyCompanionId, setHistoryCompanionId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formEmailBlocking, setFormEmailBlocking] = useState(false);
  const [formAddress, setFormAddress] = useState('');
  const [formNationality, setFormNationality] = useState(DEFAULT_NATIONALITY);
  const [formIdType, setFormIdType] = useState('national_id');
  const [formIdNumber, setFormIdNumber] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const idTypeOptions = useMemo(
    () => getIdTypeOptionsForNationality(formNationality),
    [formNationality]
  );

  const handleNationalityChange = useCallback((value: string) => {
    setFormNationality(value);
    setFormIdType((current) => {
      const options = getIdTypeOptionsForNationality(value);
      if (current && options.some((opt) => opt.value === current)) return current;
      return defaultIdTypeForNationality(value);
    });
  }, []);

  const buildQuery = () => {
    const params: string[] = [`page=${page}`, `limit=${pageSize}`];
    if (searchQuery) params.push(`search=${encodeURIComponent(searchQuery)}`);
    if (dateRange.dateFrom) params.push(`dateFrom=${dateRange.dateFrom}`);
    if (dateRange.dateTo) params.push(`dateTo=${dateRange.dateTo}`);
    return `/customers?${params.join('&')}`;
  };

  const { data, isLoading } = useQuery({
    queryKey: ['customers', searchQuery, datePreset, customDateFrom, customDateTo, page, pageSize],
    queryFn: () => api.get<{ success: boolean; data: Customer[]; meta: { total: number; page: number; totalPages: number } }>(buildQuery()),
  });

  const customers = ((data as any)?.data || []) as Customer[];
  const total = (data as any)?.meta?.total || 0;
  const totalPages = Math.max((data as any)?.meta?.totalPages || 1, 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPaginationPages(page, totalPages);

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/customers', body),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to create guest');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (res?.message?.includes('already exists')) {
        toast.info(res.message);
      } else {
        toast.success('Guest created successfully');
      }
      closeDialog();
    },
    onError: () => toast.error('Failed to create guest'),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormNationality(DEFAULT_NATIONALITY);
    setFormIdType('national_id');
    setFormIdNumber('');
    setFormNotes('');
  };

  const handleSubmit = () => {
    if (!formName || !formPhone) {
      toast.error('Name and mobile are required');
      return;
    }
    if (formEmailBlocking) {
      toast.error('Enter a valid email address');
      return;
    }

    const payload = {
      name: formName,
      phone: formPhone,
      email: formEmail || null,
      address: formAddress || null,
      nationality: formNationality || null,
      idType: formIdType || null,
      idNumber: formIdNumber || null,
      notes: formNotes || null,
    };

    createMutation.mutate(payload);
  };

  const formatStayCheckIn = (stay: GuestStay | null | undefined) => {
    if (!stay) return '—';
    return formatListBookingCheckIn(stay, times, true);
  };

  const formatStayCheckOut = (stay: GuestStay | null | undefined) => {
    if (!stay) return '—';
    return formatListBookingCheckOut(stay, times, true);
  };

  const buildExportMeta = () => ({
    filters: buildGuestsExportFilterLabels({
      datePreset,
      customDateFrom,
      customDateTo,
      search: searchQuery,
    }),
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email, role: user.role }
      : undefined,
  });

  const fetchGuestsForExport = async () => {
    const url = buildGuestsExportQuery({
      search: searchQuery,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    });
    const res = await api.get<{ success: boolean; data: GuestExportRecord[] }>(url);
    if (!res?.success) {
      throw new Error('Failed to fetch guests for export');
    }
    return res.data ?? [];
  };

  const handleExportExcel = async () => {
    setExporting('excel');
    const toastId = toast.loading('Preparing Excel export…');
    try {
      const rows = await fetchGuestsForExport();
      if (!rows.length) {
        toast.error('No guests match the current filters', { id: toastId });
        return;
      }
      await downloadGuestsExcel(rows, times, buildExportMeta());
      toast.success(`Exported ${rows.length} guest(s) to Excel`, { id: toastId });
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
      const rows = await fetchGuestsForExport();
      if (!rows.length) {
        toast.error('No guests match the current filters', { id: toastId });
        return;
      }
      await downloadGuestsPdf(rows, times, buildExportMeta());
      toast.success(`Exported ${rows.length} guest(s) to PDF`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Guest Management</h2>
          <p className="text-sm text-muted-foreground">{total} guests</p>
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
          {isAdmin && (
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Guest
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, mobile, reg. no., email, ID, address…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
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
            {GUESTS_DATE_PRESET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {datePreset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="guest-date-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="guest-date-from"
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
              <Label htmlFor="guest-date-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="guest-date-to"
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
          <div className="max-h-[min(70vh,720px)] overflow-auto custom-scrollbar">
            <table className="bookings-sticky-table bookings-sticky-table--in-scroll guests-list-table w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="col-g-name text-left font-medium">Guest name</th>
                  <th className="col-g-email text-left font-medium">Email</th>
                  <th className="col-g-mobile text-left font-medium">Mobile</th>
                  <th className="col-g-id text-left font-medium">NID / Passport / License</th>
                  <th className="col-g-address text-left font-medium">Address</th>
                  <th className="col-g-nationality text-left font-medium">Nationality</th>
                  <th className="col-g-room text-left font-medium">Room</th>
                  <th className="col-g-checkin text-left font-medium">Check-in</th>
                  <th className="col-g-checkout text-left font-medium">Check-out</th>
                  <th className="col-g-actions text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-background">
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="col-g-name">
                      <p className="gl-truncate font-medium" title={customer.name}>
                        {customer.name}
                      </p>
                    </td>
                    <td className="col-g-email">
                      <p className="gl-truncate text-muted-foreground" title={customer.email || undefined}>
                        {customer.email || '—'}
                      </p>
                    </td>
                    <td className="col-g-mobile">
                      <span className="gl-truncate inline-flex items-center gap-1 max-w-full" title={customer.phone}>
                        <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                        {customer.phone}
                      </span>
                    </td>
                    <td className="col-g-id">
                      <p
                        className="gl-truncate text-xs"
                        title={formatGuestId(customer.idType, customer.idNumber)}
                      >
                        {formatGuestId(customer.idType, customer.idNumber)}
                      </p>
                    </td>
                    <td className="col-g-address">
                      <p className="gl-truncate text-muted-foreground text-xs" title={customer.address || undefined}>
                        {customer.address || '—'}
                      </p>
                    </td>
                    <td className="col-g-nationality">
                      <p className="gl-truncate" title={customer.nationality || undefined}>
                        {customer.nationality || '—'}
                      </p>
                    </td>
                    <td className="col-g-room">
                      <p className="gl-truncate font-medium" title={customer.stay?.roomNumber || undefined}>
                        {customer.stay?.roomNumber || '—'}
                      </p>
                    </td>
                    <td
                      className="col-g-checkin"
                      title={customer.stay ? formatStayCheckIn(customer.stay) : undefined}
                    >
                      {formatStayCheckIn(customer.stay)}
                    </td>
                    <td
                      className="col-g-checkout"
                      title={customer.stay ? formatStayCheckOut(customer.stay) : undefined}
                    >
                      {formatStayCheckOut(customer.stay)}
                    </td>
                    <td className="col-g-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => {
                          setHistoryCustomerId(customer.historyCustomerId || customer.id);
                          setHistoryCompanionId(
                            customer.source === 'companion' && customer.id.startsWith('companion:')
                              ? customer.id.slice('companion:'.length)
                              : null
                          );
                        }}
                      >
                        <History className="h-3.5 w-3.5" />
                        History
                      </Button>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">
                      No guests found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {total === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
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

      <Dialog open={isAdmin && dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Guest</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Guest name" />
            </div>
            <div className="space-y-2">
              <Label>Mobile *</Label>
              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="+880..." />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <EmailInput
                value={formEmail}
                onChange={setFormEmail}
                optional
                placeholder="email@example.com"
                onValidationChange={(result) => {
                  setFormEmailBlocking(result.isBlocking);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="Address" />
            </div>
            <NationalityField
              value={formNationality}
              onChange={handleNationalityChange}
              placeholder="Type or select nationality…"
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ID Type</Label>
                <Select value={formIdType} onValueChange={setFormIdType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {idTypeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ID Number</Label>
                <Input value={formIdNumber} onChange={(e) => setFormIdNumber(e.target.value)} placeholder="ID number" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Special notes..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSubmit}
              disabled={createMutation.isPending || formEmailBlocking}
            >
              {createMutation.isPending ? 'Saving...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GuestHistoryDialog
        customerId={historyCustomerId}
        companionId={historyCompanionId}
        highlightRegistrationNumber={searchQuery.trim() || undefined}
        onClose={() => {
          setHistoryCustomerId(null);
          setHistoryCompanionId(null);
        }}
      />
    </div>
  );
}
