'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { FileDown, Grid3X3, List, Loader2, LogIn, LogOut, Plus, Search, SprayCan, CalendarPlus, CreditCard, CheckCircle2, Play, Users, UtensilsCrossed, CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, canManageRoomInventory, isHotelFrontDesk, isRoomsViewOnly, canPerformRoomCleaning, isHousekeeper } from '@/lib/auth-store';
import { downloadRoomsPdf, type RoomExportRecord } from '@/lib/rooms-export';
import { getRoomNightlyTotal } from '@/lib/room-pricing';
import { openNewReservationTab } from '@/lib/reservation-navigation';
import { openCheckoutTab } from '@/lib/checkout-navigation';
import { canBookingCheckIn } from '@/lib/reservation-completion-fields';
import { BookingAddPaymentDialog } from './BookingAddPaymentDialog';
import { BookingRestaurantBillDialog } from './BookingRestaurantBillDialog';
import {
  CleaningStaffSearchField,
  formatCleaningStaffLabel,
  type CleaningStaffResult,
} from './CleaningStaffSearchField';
import { formatPaymentMethod } from '@/lib/payment-method';
import { useBusinessDate } from '@/hooks/use-business-date';
import { formatBdt } from '@/lib/currency';
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoomBookingGuestPanel } from './RoomBookingGuestPanel';
import { ReservedEntryRoomsPanel } from './ReservedEntryRoomsPanel';
import {
  formatRoomsViewDateLabel,
  ROOMS_VIEW_DATE_OPTIONS,
  type RoomsViewDateScope,
} from '@/lib/rooms-view-date-filter';

const ROOMS_PER_ROW = 8;

type CheckInPaymentLine = { id: string; amount: number; method: string };

function formatGuestPax(adults?: number | null, children?: number | null): string {
  const total = (adults ?? 1) + (children ?? 0);
  return `${total} pax`;
}

function shouldShowGuestPax(displayStatus: string): boolean {
  return displayStatus === 'OCCUPIED' || displayStatus === 'RESERVED' || displayStatus === 'ENTRY_HELD';
}

function formatRoomStatusLabel(status: string, categoryPool?: boolean): string {
  if (status === 'CLEANING' || status === 'IN_PROGRESS') return 'Dirty';
  if (status === 'AVAILABLE') return 'Available';
  if (status === 'RESERVED') return 'Reserved';
  if (status === 'ENTRY_HELD') return categoryPool ? 'Entry pool' : 'Entry hold';
  if (status === 'OCCUPIED') return 'Occupied';
  if (status === 'MAINTENANCE') return 'Maintenance';
  return status.replace(/_/g, ' ');
}

type ManualRoomStatus = 'AVAILABLE' | 'MAINTENANCE';

function canManuallyEditRoomStatus(status: string): status is ManualRoomStatus {
  return status === 'AVAILABLE' || status === 'MAINTENANCE';
}

function manualRoomStatusOptions(currentStatus: string): ManualRoomStatus[] {
  if (currentStatus === 'AVAILABLE') return ['AVAILABLE', 'MAINTENANCE'];
  if (currentStatus === 'MAINTENANCE') return ['MAINTENANCE', 'AVAILABLE'];
  return [];
}

function chunkRooms<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  status: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE';
  displayStatus?: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE' | 'IN_PROGRESS' | 'ENTRY_HELD';
  entryHold?: { entryId: string; guestName: string | null; checkIn: string; categoryPool?: boolean } | null;
  typeId: string;
  totalPrice: number;
  type: {
    id: string;
    name: string;
    capacity: number;
  };
  activeBooking?: {
    id: string;
    status: string;
    checkIn: string;
    checkOut: string;
    customerName?: string | null;
    adults?: number;
    children?: number;
    dueAmount?: number;
    totalRoomCharge?: number;
    advancePayment?: number;
    vatPercent?: number | null;
    vatAmount?: number | null;
    totalWithVat?: number | null;
    isInitialReservation?: boolean;
    isCorporateGuest?: boolean;
    nidPhysicallyReceived?: boolean;
  } | null;
  pendingHousekeepingTask?: { id: string; status?: 'PENDING' | 'IN_PROGRESS' } | null;
  housekeepingTask?: { id: string; status: 'PENDING' | 'IN_PROGRESS' } | null;
}

interface RoomType {
  id: string;
  name: string;
  capacity: number;
}

interface HousekeepingTaskLite {
  id: string;
  roomId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export function RoomsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManageRooms = canManageRoomInventory(user?.role);
  const isStatusOnly = isHotelFrontDesk(user?.role);
  const isViewOnly = isRoomsViewOnly(user?.role);
  const isHousekeeperUser = isHousekeeper(user?.role);
  const canCleanRooms = canPerformRoomCleaning(user?.role);
  const showRoomActions = canCleanRooms || !isViewOnly;
  const FLOOR_OPTIONS = [8, 9, 10];
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [checkInPayment, setCheckInPayment] = useState('0');
  const [checkInPaymentMethod, setCheckInPaymentMethod] = useState('CASH');
  const [checkInPaymentLines, setCheckInPaymentLines] = useState<CheckInPaymentLine[]>([]);
  const [addPaymentBookingId, setAddPaymentBookingId] = useState<string | null>(null);
  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [restaurantBillBookingId, setRestaurantBillBookingId] = useState<string | null>(null);
  const [restaurantBillDialogOpen, setRestaurantBillDialogOpen] = useState(false);
  const [restaurantBillGuestLabel, setRestaurantBillGuestLabel] = useState<string | undefined>();
  const [restaurantBillRoomNumber, setRestaurantBillRoomNumber] = useState<string | undefined>();
  const [startCleaningDialogOpen, setStartCleaningDialogOpen] = useState(false);
  const [startCleaningRoom, setStartCleaningRoom] = useState<Room | null>(null);
  const [startCleaningTaskId, setStartCleaningTaskId] = useState<string | null>(null);
  const [startCleaningStaffId, setStartCleaningStaffId] = useState('');
  const [startCleaningStaffLabel, setStartCleaningStaffLabel] = useState('');
  const [startCleaningNotes, setStartCleaningNotes] = useState('');

  const { data: businessDateRes } = useBusinessDate();
  const businessDate = businessDateRes?.data?.businessDate;

  // Form state
  const [formRoomNumber, setFormRoomNumber] = useState('');
  const [formFloor, setFormFloor] = useState('8');
  const [formTypeId, setFormTypeId] = useState('');
  const [formStatus, setFormStatus] = useState('AVAILABLE');
  const [formTotalPrice, setFormTotalPrice] = useState('');
  const [editDialogTab, setEditDialogTab] = useState<'room' | 'guest'>('room');
  const [pageMenuTab, setPageMenuTab] = useState<'rooms' | 'reserved_entry'>('rooms');
  const [viewDateScope, setViewDateScope] = useState<RoomsViewDateScope>('business_day');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  const { data: roomTypesData } = useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ success: boolean; data: RoomType[] }>('/room-types'),
  });

  const roomTypes = (roomTypesData as any)?.data || [];

  const buildQuery = () => {
    const params: string[] = [];
    if (floorFilter !== 'all') params.push(`floor=${floorFilter}`);
    if (typeFilter !== 'all') params.push(`typeId=${typeFilter}`);
    params.push(`viewScope=${encodeURIComponent(viewDateScope)}`);
    if (viewDateScope === 'custom') {
      if (customDateFrom) params.push(`dateFrom=${encodeURIComponent(customDateFrom)}`);
      if (customDateTo) params.push(`dateTo=${encodeURIComponent(customDateTo)}`);
    }
    params.push('limit=100');
    return `/rooms?${params.join('&')}`;
  };

  const viewDateReady =
    viewDateScope !== 'custom' || Boolean(customDateFrom || customDateTo || businessDate);

  const { data: roomsData, isLoading, isFetching } = useQuery({
    queryKey: ['rooms', floorFilter, typeFilter, viewDateScope, customDateFrom, customDateTo],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: Room[];
        meta: {
          total: number;
          viewLabel?: string;
          viewIsOperational?: boolean;
          viewStayCheckIn?: string;
          viewStayCheckOut?: string;
          categoryCapacity?: Array<{
            roomTypeId: string;
            typeName: string;
            total: number;
            available: number;
            entryHeld: number;
            maintenance: number;
          }>;
        };
      }>(buildQuery()),
    enabled: viewDateReady,
  });

  const viewDateLabel =
    roomsData?.meta?.viewLabel ??
    formatRoomsViewDateLabel(viewDateScope, businessDate, customDateFrom, customDateTo);

  const viewIsOperational = roomsData?.meta?.viewIsOperational !== false;
  const viewIsFuture = !viewIsOperational;
  const viewStayCheckIn = roomsData?.meta?.viewStayCheckIn;
  const viewStayCheckOut = roomsData?.meta?.viewStayCheckOut;

  const openReserveForRoom = (roomId: string) => {
    openNewReservationTab({
      roomId,
      checkIn: viewStayCheckIn,
      checkOut: viewStayCheckOut,
    });
  };

  const categoryCapacity = (roomsData as { meta?: { categoryCapacity?: Array<{
    roomTypeId: string;
    typeName: string;
    total: number;
    available: number;
    entryHeld: number;
    maintenance: number;
  }> } })?.meta?.categoryCapacity?.filter(
    (row) => row.entryHeld > 0 || row.maintenance > 0
  ) ?? [];

  const { data: housekeepingInProgressData } = useQuery({
    queryKey: ['housekeeping-room-status', 'IN_PROGRESS'],
    queryFn: () =>
      api.get<{ success: boolean; data: HousekeepingTaskLite[]; meta: { total: number } }>(
        '/housekeeping?status=IN_PROGRESS&limit=200'
      ),
  });

  const rooms = ((roomsData as any)?.data || []) as Room[];
  const housekeepingInProgress = ((housekeepingInProgressData as any)?.data || []) as HousekeepingTaskLite[];
  const roomsWithCleaningInProgress = new Set(housekeepingInProgress.map((t) => t.roomId));

  const checkInMutation = useMutation({
    mutationFn: ({
      id,
      checkInPayments,
    }: {
      id: string;
      checkInPayments: Array<{ amount: number; method: string }>;
    }) => api.post(`/bookings/check-in/${id}`, { checkInPayments }),
    onSuccess: (res: { success?: boolean; error?: string; message?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to check in');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Guest checked in successfully');
      setCheckInDialogOpen(false);
      setCheckInRoom(null);
      setCheckInPayment('0');
      setCheckInPaymentMethod('CASH');
      setCheckInPaymentLines([]);
    },
    onError: () => toast.error('Failed to check in'),
  });

  const createHousekeepingTaskMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.post('/housekeeping', { roomId, taskType: 'cleaning' }),
  });

  const housekeepingUpdateMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      status: string;
      cleaningStaffId?: string;
      notes?: string | null;
    }) => api.put('/housekeeping', payload),
    onSuccess: (res: { success?: boolean; error?: string; message?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Housekeeping update failed');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      queryClient.invalidateQueries({ queryKey: ['housekeeping-room-status'] });
      queryClient.invalidateQueries({ queryKey: ['housekeeping-count'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: () => toast.error('Housekeeping update failed'),
    });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/rooms', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Room created successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to create room'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/rooms/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Room updated successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to update room'),
  });

  const closeDialog = () => {
    setAddDialogOpen(false);
    setEditRoom(null);
    setEditDialogTab('room');
    setFormRoomNumber('');
    setFormFloor('8');
    setFormTypeId('');
    setFormStatus('AVAILABLE');
    setFormTotalPrice('');
  };

  const openEditDialog = (room: Room) => {
    if (isViewOnly) return;
    const booking = room.activeBooking;
    const openGuestTab =
      Boolean(booking?.id) &&
      (booking?.status === 'RESERVED' || booking?.status === 'CHECKED_IN');
    setEditRoom(room);
    setEditDialogTab(openGuestTab ? 'guest' : 'room');
    setFormRoomNumber(room.roomNumber);
    setFormFloor(String(room.floor));
    setFormTypeId(room.typeId);
    setFormStatus(room.status);
    setFormTotalPrice(String(room.totalPrice ?? 0));
    setAddDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editRoom && isStatusOnly) {
      if (!canManuallyEditRoomStatus(editRoom.status)) {
        toast.error('Status can only be changed when the room is Available or Maintenance');
        return;
      }
      updateMutation.mutate({ id: editRoom.id, status: formStatus });
      return;
    }

    if (!formRoomNumber || !formTypeId) {
      toast.error('Room number and type are required');
      return;
    }

    const payload: Record<string, unknown> = {
      roomNumber: formRoomNumber,
      floor: parseInt(formFloor),
      typeId: formTypeId,
      totalPrice: parseFloat(formTotalPrice) || 0,
    };

    if (editRoom) {
      if (canManuallyEditRoomStatus(editRoom.status)) {
        payload.status = formStatus;
      }
      updateMutation.mutate({ id: editRoom.id, ...payload });
    } else {
      createMutation.mutate({ ...payload, status: 'AVAILABLE' });
    }
  };

  const getStatusContainerClasses = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600';
      case 'RESERVED':
        return 'bg-sky-500 border-sky-600 text-white hover:bg-sky-600';
      case 'ENTRY_HELD':
        return 'bg-violet-500 border-violet-600 text-white hover:bg-violet-600';
      case 'OCCUPIED':
        return 'bg-yellow-400 border-yellow-500 text-yellow-950 hover:bg-yellow-500';
      case 'CLEANING':
      case 'IN_PROGRESS':
        return 'bg-slate-500 border-slate-600 text-white hover:bg-slate-600';
      case 'MAINTENANCE':
        return 'bg-red-500 border-red-600 text-white hover:bg-red-600';
      default:
        return 'bg-muted border-border text-foreground';
    }
  };

  const getDisplayStatus = (room: Room) =>
    room.displayStatus ??
    (room.status === 'CLEANING' && roomsWithCleaningInProgress.has(room.id)
      ? 'IN_PROGRESS'
      : room.status);

  const getRoomHousekeepingTask = (room: Room) =>
    room.housekeepingTask ?? room.pendingHousekeepingTask ?? null;

  const resetStartCleaningForm = () => {
    setStartCleaningStaffId('');
    setStartCleaningStaffLabel('');
    setStartCleaningNotes('');
  };

  const closeStartCleaningDialog = () => {
    setStartCleaningDialogOpen(false);
    setStartCleaningRoom(null);
    setStartCleaningTaskId(null);
    resetStartCleaningForm();
  };

  const openStartCleaningForRoom = async (room: Room) => {
    let task = getRoomHousekeepingTask(room);
    if (!task?.id) {
      try {
        const res = (await createHousekeepingTaskMutation.mutateAsync(room.id)) as {
          success?: boolean;
          data?: { id: string };
          error?: string;
        };
        if (!res?.success || !res.data?.id) {
          toast.error(res?.error || 'Failed to create cleaning task');
          return;
        }
        task = { id: res.data.id, status: 'PENDING' };
      } catch {
        toast.error('Failed to create cleaning task');
        return;
      }
    }
    setStartCleaningRoom(room);
    setStartCleaningTaskId(task.id);
    resetStartCleaningForm();
    setStartCleaningDialogOpen(true);
  };

  const handleStartCleaning = () => {
    if (!startCleaningTaskId) return;
    if (!startCleaningStaffId) {
      toast.error('Please assign cleaning staff');
      return;
    }
    housekeepingUpdateMutation.mutate(
      {
        id: startCleaningTaskId,
        status: 'IN_PROGRESS',
        cleaningStaffId: startCleaningStaffId,
        notes: startCleaningNotes.trim() || null,
      },
      {
        onSuccess: (res: { success?: boolean }) => {
          if (res?.success) {
            toast.success('Cleaning started');
            closeStartCleaningDialog();
          }
        },
      }
    );
  };

  const handleCompleteCleaning = (taskId: string) => {
    housekeepingUpdateMutation.mutate(
      { id: taskId, status: 'COMPLETED' },
      {
        onSuccess: (res: { success?: boolean }) => {
          if (res?.success) toast.success('Room cleaning completed');
        },
      }
    );
  };

  const totalCheckInPaid = () => checkInPaymentLines.reduce((sum, line) => sum + line.amount, 0);

  const handleRecordCheckInPayment = () => {
    const amount = parseFloat(checkInPayment) || 0;
    if (amount <= 0) {
      toast.error('Enter a payment amount greater than zero');
      return;
    }
    setCheckInPaymentLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        amount,
        method: checkInPaymentMethod,
      },
    ]);
    setCheckInPayment('0');
  };

  const openCheckInForRoom = (room: Room) => {
    if (!room.activeBooking?.id) return;
    setCheckInRoom(room);
    setCheckInPayment('0');
    setCheckInPaymentMethod('CASH');
    setCheckInPaymentLines([]);
    setCheckInDialogOpen(true);
  };

  const renderRoomActions = (room: Room, compact = false) => {
    const displayStatus = getDisplayStatus(room);
    const booking = room.activeBooking;
    const btnClass = compact ? 'h-7 px-2 text-[10px]' : 'h-8 px-2 text-xs';

    if (viewIsFuture && displayStatus === 'AVAILABLE') {
      if (isViewOnly) return null;
      return (
        <Button
          type="button"
          size="sm"
          className={cn('bg-sky-600 hover:bg-sky-700 text-white', btnClass)}
          onClick={(e) => {
            e.stopPropagation();
            openReserveForRoom(room.id);
          }}
        >
          <CalendarPlus className="w-3 h-3 mr-1" />
          Reserve
        </Button>
      );
    }

    if (!viewIsOperational) {
      return null;
    }

    if (displayStatus === 'CLEANING' || displayStatus === 'IN_PROGRESS') {
      if (!canCleanRooms) return null;
      const hkTask = getRoomHousekeepingTask(room);
      if (hkTask?.status === 'IN_PROGRESS' && hkTask.id) {
        return (
          <Button
            type="button"
            size="sm"
            className={cn('bg-emerald-600 hover:bg-emerald-700 text-white', btnClass)}
            onClick={(e) => {
              e.stopPropagation();
              handleCompleteCleaning(hkTask.id);
            }}
            disabled={housekeepingUpdateMutation.isPending}
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Complete
          </Button>
        );
      }
      return (
        <Button
          type="button"
          size="sm"
          className={cn('bg-slate-700 hover:bg-slate-800 text-white', btnClass)}
          onClick={(e) => {
            e.stopPropagation();
            void openStartCleaningForRoom(room);
          }}
          disabled={createHousekeepingTaskMutation.isPending}
        >
          <Play className="w-3 h-3 mr-1" />
          Start cleaning
        </Button>
      );
    }

    if (isViewOnly) return null;

    const canCheckIn =
      displayStatus === 'RESERVED' &&
      booking?.status === 'RESERVED' &&
      canBookingCheckIn({
        isInitialReservation: booking.isInitialReservation,
        nidPhysicallyReceived: booking.nidPhysicallyReceived,
        isCorporateGuest: booking.isCorporateGuest,
      });

    if (displayStatus === 'OCCUPIED' && booking?.status === 'CHECKED_IN') {
      return (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('border-orange-500 text-orange-700 hover:bg-orange-50 bg-white/90', btnClass)}
            onClick={(e) => {
              e.stopPropagation();
              setRestaurantBillBookingId(booking.id);
              setRestaurantBillGuestLabel(booking.customerName);
              setRestaurantBillRoomNumber(room.roomNumber);
              setRestaurantBillDialogOpen(true);
            }}
            title="Add restaurant bill"
          >
            <UtensilsCrossed className="w-3 h-3 mr-1" />
            F&B
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('border-violet-500 text-violet-700 hover:bg-violet-50 bg-white/90', btnClass)}
            onClick={(e) => {
              e.stopPropagation();
              setAddPaymentBookingId(booking.id);
              setAddPaymentDialogOpen(true);
            }}
            title="Add payment"
          >
            <CreditCard className="w-3 h-3 mr-1" />
            Pay
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn('bg-yellow-600 hover:bg-yellow-700 text-white', btnClass)}
            onClick={(e) => {
              e.stopPropagation();
              openCheckoutTab(booking.id);
            }}
          >
            <LogOut className="w-3 h-3 mr-1" />
            Check-out
          </Button>
        </div>
      );
    }

    if (canCheckIn && booking) {
      return (
        <Button
          type="button"
          size="sm"
          className={cn('bg-emerald-600 hover:bg-emerald-700 text-white', btnClass)}
          onClick={(e) => {
            e.stopPropagation();
            openCheckInForRoom(room);
          }}
          disabled={checkInMutation.isPending}
        >
          <LogIn className="w-3 h-3 mr-1" />
          Check-in
        </Button>
      );
    }

    if (displayStatus === 'AVAILABLE') {
      return (
        <Button
          type="button"
          size="sm"
          className={cn('bg-sky-600 hover:bg-sky-700 text-white', btnClass)}
          onClick={(e) => {
            e.stopPropagation();
            openReserveForRoom(room.id);
          }}
        >
          <CalendarPlus className="w-3 h-3 mr-1" />
          Reserve
        </Button>
      );
    }

    return null;
  };

  const filteredRooms = (() => {
    let list = rooms;
    if (statusFilter !== 'all') {
      list = list.filter((room) => getDisplayStatus(room) === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) => r.roomNumber.includes(search.trim()) || r.type?.name?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (a.floor !== b.floor) return a.floor - b.floor;
      return Number(a.roomNumber) - Number(b.roomNumber);
    });
  })();

  const floorGroups = [...new Set(filteredRooms.map((r) => r.floor))]
    .sort((a, b) => a - b)
    .map((floor) => ({
      floor,
      rows: chunkRooms(
        filteredRooms.filter((r) => r.floor === floor),
        ROOMS_PER_ROW
      ),
    }));

  const buildExportRows = (): RoomExportRecord[] =>
    filteredRooms.map((room) => ({
      roomNumber: room.roomNumber,
      floor: room.floor,
      status: room.status,
      displayStatus: getDisplayStatus(room),
      typeName: room.type?.name ?? '',
      basePrice: getRoomNightlyTotal(room),
    }));

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email }
      : undefined,
    filters: {
      dateView: viewDateLabel,
      status: statusFilter === 'all' ? 'All status' : formatRoomStatusLabel(statusFilter),
      floor: floorFilter === 'all' ? 'All floors' : `Floor ${floorFilter}`,
      type:
        typeFilter === 'all'
          ? 'All types'
          : roomTypes.find((rt: RoomType) => rt.id === typeFilter)?.name ?? typeFilter,
      search: search.trim() || '—',
    },
  });

  const handleExportPdf = async () => {
    setExportingPdf(true);
    const toastId = toast.loading('Preparing PDF export…');
    try {
      const rows = buildExportRows();
      if (!rows.length) {
        toast.error('No rooms match the current filters', { id: toastId });
        return;
      }
      await downloadRoomsPdf(rows, buildExportMeta());
      toast.success(`Exported ${rows.length} room(s) to PDF`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  const renderRoomTile = (room: Room) => {
    const displayStatus = getDisplayStatus(room);
    const isLightText = displayStatus === 'OCCUPIED';
    const guestLabel = room.activeBooking?.customerName ?? room.entryHold?.guestName ?? undefined;
    const entryPoolHold = displayStatus === 'ENTRY_HELD' && room.entryHold?.categoryPool;
    const guestPax =
      room.activeBooking && shouldShowGuestPax(displayStatus)
        ? formatGuestPax(room.activeBooking.adults, room.activeBooking.children)
        : null;

    return (
      <div
        key={room.id}
        className={cn(
          'flex min-h-[118px] w-full flex-col justify-between rounded-lg border p-3 text-left shadow-sm transition-colors',
          getStatusContainerClasses(displayStatus),
          !isViewOnly && 'cursor-pointer'
        )}
        onClick={() => openEditDialog(room)}
        onKeyDown={(e) => {
          if (isViewOnly) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEditDialog(room);
          }
        }}
        role={isViewOnly ? undefined : 'button'}
        tabIndex={isViewOnly ? undefined : 0}
      >
        <div className="flex flex-1 flex-col justify-between text-left">
        <div className="flex items-start justify-between gap-1">
          <p className="text-lg font-bold leading-none">{room.roomNumber}</p>
            <div className="flex flex-col items-end gap-0.5">
              {guestPax ? (
                <span
                  className={cn(
                    'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    isLightText ? 'bg-yellow-600/25 text-yellow-950' : 'bg-black/20 text-inherit'
                  )}
                >
                  <Users className="h-2.5 w-2.5" />
                  {guestPax}
                </span>
              ) : null}
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              isLightText ? 'bg-yellow-600/20 text-yellow-950' : 'bg-black/15 text-inherit'
            )}
          >
                {formatRoomStatusLabel(displayStatus, room.entryHold?.categoryPool)}
          </span>
            </div>
        </div>
        <div className={cn('space-y-0.5 text-xs', isLightText ? 'text-yellow-900/80' : 'text-white/90')}>
          <p className="font-medium">{room.type?.name}</p>
            {guestLabel ? (
              <p className="truncate opacity-90">
                {guestLabel}
                {entryPoolHold ? ' · category pool' : ''}
              </p>
            ) : entryPoolHold ? (
              <p className="truncate opacity-90">Category pool (unassigned)</p>
            ) : null}
            <p>৳{getRoomNightlyTotal(room).toLocaleString()}/night</p>
        </div>
        </div>
        {!showRoomActions ? null : (
        <div className="mt-2 pt-2 border-t border-white/20" onClick={(e) => e.stopPropagation()}>
          {renderRoomActions(room)}
        </div>
        )}
      </div>
    );
  };

  const editBookingId = editRoom?.activeBooking?.id;
  const showGuestTab =
    Boolean(editBookingId) &&
    (editRoom?.activeBooking?.status === 'RESERVED' ||
      editRoom?.activeBooking?.status === 'CHECKED_IN');

  const renderRoomStatusField = () => {
    if (!editRoom) return null;

    if (!canManuallyEditRoomStatus(editRoom.status)) {
      return (
        <div className="space-y-2">
          <Label>Status</Label>
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <p className="font-medium">{formatRoomStatusLabel(getDisplayStatus(editRoom))}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Reserved, occupied, and dirty rooms are updated automatically by the system.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label>Status</Label>
        <Select value={formStatus} onValueChange={setFormStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {manualRoomStatusOptions(editRoom.status).map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'AVAILABLE' ? 'Available' : 'Maintenance'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const canSubmitRoomStatus =
    !editRoom || !isStatusOnly || canManuallyEditRoomStatus(editRoom.status);

  const renderRoomFormFields = () => (
    <>
      {editRoom && isStatusOnly ? (
        <>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <p><span className="text-muted-foreground">Room:</span> {formRoomNumber}</p>
            <p><span className="text-muted-foreground">Floor:</span> {formFloor}</p>
            <p>
              <span className="text-muted-foreground">Type:</span>{' '}
              {roomTypes.find((rt: RoomType) => rt.id === formTypeId)?.name ?? '—'}
            </p>
          </div>
          {renderRoomStatusField()}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Room Number</Label>
            <Input
              value={formRoomNumber}
              onChange={(e) => setFormRoomNumber(e.target.value)}
              placeholder="e.g. 101"
            />
          </div>
          <div className="space-y-2">
            <Label>Floor</Label>
            <Select value={formFloor} onValueChange={setFormFloor}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOOR_OPTIONS.map((f) => (
                  <SelectItem key={f} value={String(f)}>Floor {f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Room Type</Label>
            <Select value={formTypeId} onValueChange={setFormTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((rt: RoomType) => (
                  <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Total Price / Night (BDT)</Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Inclusive of VAT and service charge
            </p>
            <Input
              type="number"
              min="0"
              value={formTotalPrice}
              onChange={(e) => setFormTotalPrice(e.target.value)}
              placeholder="e.g. 3500"
            />
          </div>
          {editRoom && renderRoomStatusField()}
        </>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Rooms</h2>
          <p className="text-sm text-muted-foreground">
            {filteredRooms.length} rooms found · {viewDateLabel}
            {viewIsFuture ? ' · availability for selected stay dates' : ''}
            {isFetching && !isLoading ? ' · updating…' : ''}
            {isHousekeeperUser ? ' · start or complete cleaning on dirty rooms' : ''}
          </p>
        </div>
        {!isViewOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf || isLoading}
          >
            {exportingPdf ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Export PDF
          </Button>
          {canManageRooms && (
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setAddDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Room
            </Button>
          )}
        </div>
        ) : null}
      </div>

      <Tabs value={pageMenuTab} onValueChange={(v) => setPageMenuTab(v as 'rooms' | 'reserved_entry')}>
        <TabsList>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          {!isHousekeeperUser ? (
            <TabsTrigger value="reserved_entry">Reserved entry</TabsTrigger>
          ) : null}
        </TabsList>

        {!isHousekeeperUser ? (
          <TabsContent value="reserved_entry" className="mt-4">
            <ReservedEntryRoomsPanel />
          </TabsContent>
        ) : null}

        <TabsContent value="rooms" className="mt-4 space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          value={viewDateScope}
          onValueChange={(v) => setViewDateScope(v as RoomsViewDateScope)}
        >
          <SelectTrigger className="w-48">
            <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Date view" />
          </SelectTrigger>
          <SelectContent>
            {ROOMS_VIEW_DATE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {viewDateScope === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="rooms-date-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="rooms-date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rooms-date-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="rooms-date-to"
                type="date"
                value={customDateTo}
                min={customDateFrom || undefined}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="w-40"
              />
            </div>
          </>
        )}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search room number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="RESERVED">Reserved</SelectItem>
            <SelectItem value="ENTRY_HELD">Entry hold</SelectItem>
            <SelectItem value="OCCUPIED">Occupied</SelectItem>
            <SelectItem value="CLEANING">Dirty</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={floorFilter} onValueChange={setFloorFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Floor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Floors</SelectItem>
            {FLOOR_OPTIONS.map((f) => (
              <SelectItem key={f} value={String(f)}>Floor {f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Room Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {roomTypes.map((rt: RoomType) => (
              <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex border rounded-lg overflow-hidden">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setViewMode('grid')}
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setViewMode('list')}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {viewIsFuture ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
          <p className="font-medium">Future availability view</p>
          <p className="mt-1 text-sky-800">
            Room status reflects bookings overlapping the stay night of {viewDateLabel} (check-in
            from 2:00 PM, check-out by 12:00 PM). A room reserved until 24 Jun is available for the
            night starting 24 Jun after checkout. Check-in, check-out, and payments are hidden until
            that date is the open business day.
          </p>
        </div>
      ) : null}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, row) => (
            <div key={row} className="grid grid-cols-8 gap-2">
              {Array.from({ length: ROOMS_PER_ROW }).map((_, i) => (
                <Skeleton key={i} className="h-[92px] rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-6">
          {categoryCapacity.length > 0 ? (
            <div className="rounded-lg border border-violet-200 bg-violet-50/80 px-4 py-3 text-sm">
              <p className="font-medium text-violet-900">
                Reservation entry inventory · {viewDateLabel}
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-violet-800">
                {categoryCapacity.map((row) => (
                  <li key={row.roomTypeId}>
                    <span className="font-medium">{row.typeName}:</span>{' '}
                    {row.available} available · {row.entryHeld} entry pool
                    {row.maintenance > 0 ? ` · ${row.maintenance} maintenance` : ''}
                    <span className="text-violet-600"> (of {row.total} total)</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-violet-700">
                Category entries reserve inventory by count, not by fixed room numbers. Any free room
                in the category can still be booked until the remaining slots for this day are used.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-emerald-500" />
              Available
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-sky-500" />
              Reserved
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-violet-500" />
              Entry pool / hold
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-yellow-400" />
              Occupied
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-slate-500" />
              Dirty
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-red-500" />
              Maintenance
            </span>
          </div>

          {floorGroups.map(({ floor, rows }) => (
            <div key={floor} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Floor {floor}</h3>
              {rows.map((rowRooms, rowIndex) => (
                <div
                  key={`${floor}-${rowIndex}`}
                  className="grid grid-cols-8 gap-2"
                >
                  {rowRooms.map((room) => renderRoomTile(room))}
                </div>
              ))}
            </div>
          ))}

          {filteredRooms.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">No rooms match your filters.</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border max-h-[600px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-3 font-medium">Room</th>
                <th className="text-left p-3 font-medium">Floor</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Total / Night</th>
                <th className="text-left p-3 font-medium">Status</th>
                {!showRoomActions ? null : <th className="text-left p-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((room) => (
                (() => {
                  const displayStatus = getDisplayStatus(room);
                  const guestPax =
                    room.activeBooking && shouldShowGuestPax(displayStatus)
                      ? formatGuestPax(room.activeBooking.adults, room.activeBooking.children)
                      : null;
                  return (
                <tr
                  key={room.id}
                  className={cn('border-t hover:bg-muted/30', !isViewOnly && 'cursor-pointer')}
                  onClick={() => openEditDialog(room)}
                >
                  <td className="p-3 font-medium">
                    {room.roomNumber}
                    {guestPax ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({guestPax})</span>
                    ) : null}
                  </td>
                  <td className="p-3">{room.floor}</td>
                  <td className="p-3">{room.type?.name}</td>
                  <td className="p-3">৳{getRoomNightlyTotal(room).toLocaleString()}</td>
                  <td className="p-3"><StatusBadge status={displayStatus} label={formatRoomStatusLabel(displayStatus)} /></td>
                  {!showRoomActions ? null : (
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-2">
                      {renderRoomActions(room, true)}
                      {!isViewOnly ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(room);
                        }}
                      >
                      {isStatusOnly ? 'Change status' : 'Edit'}
                    </Button>
                      ) : null}
                    </div>
                  </td>
                  )}
                </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
      )}

        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className={cn(showGuestTab && 'max-w-2xl')}>
          <DialogHeader>
            <DialogTitle>
              {editRoom
                ? isStatusOnly
                  ? 'Change Room Status'
                  : `Edit Room ${formRoomNumber}`
                : 'Add New Room'}
            </DialogTitle>
          </DialogHeader>
          {showGuestTab && editBookingId ? (
            <Tabs value={editDialogTab} onValueChange={(v) => setEditDialogTab(v as 'room' | 'guest')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="room">Room</TabsTrigger>
                <TabsTrigger value="guest">Guest info</TabsTrigger>
              </TabsList>
              <TabsContent value="room" className="mt-4 space-y-4">
                {renderRoomFormFields()}
              </TabsContent>
              <TabsContent value="guest" className="mt-4">
                <RoomBookingGuestPanel bookingId={editBookingId} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">{renderRoomFormFields()}</div>
          )}
          <DialogFooter>
            {showGuestTab && editDialogTab === 'guest' ? (
              <Button variant="outline" onClick={closeDialog}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                {(canSubmitRoomStatus || !editRoom) && (
                  <Button
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleSubmit}
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {(createMutation.isPending || updateMutation.isPending)
                      ? 'Saving...'
                      : editRoom
                        ? isStatusOnly
                          ? 'Update status'
                          : 'Update'
                        : 'Create'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-emerald-600" />
              Check-in — Room {checkInRoom?.roomNumber}
            </DialogTitle>
          </DialogHeader>
          {checkInRoom?.activeBooking && (
            <div className="space-y-4">
              <Card className="bg-muted/50">
                <CardContent className="p-3 space-y-1">
                  <p className="text-sm font-medium">{checkInRoom.activeBooking.customerName}</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Room charge</span>
                    <span>{formatBdt(checkInRoom.activeBooking.totalRoomCharge ?? 0)}</span>
                </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-1">
                    <span>Current due</span>
                    <span className="text-red-600">
                      {formatBdt(
                        Math.max(
                          0,
                          (checkInRoom.activeBooking.dueAmount ?? 0) - totalCheckInPaid()
                        )
                      )}
                    </span>
                </div>
                </CardContent>
              </Card>
                <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
                  <div className="space-y-2">
                    <Label htmlFor="checkin-payment-amount">Payment amount (BDT)</Label>
                  <Input
                      id="checkin-payment-amount"
                      type="number"
                      min="0"
                      className="h-10"
                      value={checkInPayment}
                      onChange={(e) => setCheckInPayment(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="checkin-payment-method">Payment method</Label>
                    <Select value={checkInPaymentMethod} onValueChange={setCheckInPaymentMethod}>
                      <SelectTrigger id="checkin-payment-method" className="h-10 w-full">
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
                  <Button
                    type="button"
                    className="h-10 w-full bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 sm:w-auto sm:min-w-[5.5rem]"
                    onClick={handleRecordCheckInPayment}
                  >
                    Pay
                  </Button>
                </div>
              </div>
              {checkInPaymentLines.length > 0 && (
                <Card className="border-emerald-200">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-sm font-semibold text-emerald-900">Payments at check-in</p>
                    {checkInPaymentLines.map((line) => (
                      <div key={line.id} className="flex justify-between text-sm">
                        <span>{formatPaymentMethod(line.method)}</span>
                        <span className="font-medium">{formatBdt(line.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-semibold border-t pt-2">
                      <span>Total paying now</span>
                      <span>{formatBdt(totalCheckInPaid())}</span>
                </div>
                  </CardContent>
                </Card>
              )}
                  </div>
                )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={checkInMutation.isPending || !checkInRoom?.activeBooking?.id}
              onClick={() => {
                const bookingId = checkInRoom?.activeBooking?.id;
                if (!bookingId) return;
                checkInMutation.mutate({
                  id: bookingId,
                  checkInPayments: checkInPaymentLines.map((line) => ({
                    amount: line.amount,
                    method: line.method,
                  })),
                });
              }}
            >
              {checkInMutation.isPending ? 'Checking in...' : 'Confirm check-in'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startCleaningDialogOpen} onOpenChange={(open) => { if (!open) closeStartCleaningDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SprayCan className="h-5 w-5 text-slate-600" />
              Start cleaning — Room {startCleaningRoom?.roomNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <CleaningStaffSearchField
              selectedId={startCleaningStaffId}
              selectedLabel={startCleaningStaffLabel}
              onSelect={(staff: CleaningStaffResult) => {
                setStartCleaningStaffId(staff.id);
                setStartCleaningStaffLabel(formatCleaningStaffLabel(staff));
              }}
              onClear={() => {
                setStartCleaningStaffId('');
                setStartCleaningStaffLabel('');
              }}
            />
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                value={startCleaningNotes}
                onChange={(e) => setStartCleaningNotes(e.target.value)}
                placeholder="Any special instructions"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStartCleaningDialog}>
              Cancel
            </Button>
            <Button
              className="bg-slate-700 hover:bg-slate-800 text-white"
              disabled={housekeepingUpdateMutation.isPending || !startCleaningTaskId}
              onClick={handleStartCleaning}
            >
              {housekeepingUpdateMutation.isPending ? 'Starting...' : 'Start cleaning'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingAddPaymentDialog
        bookingId={addPaymentBookingId}
        open={addPaymentDialogOpen}
        onOpenChange={(open) => {
          setAddPaymentDialogOpen(open);
          if (!open) {
            setAddPaymentBookingId(null);
            queryClient.invalidateQueries({ queryKey: ['rooms'] });
          }
        }}
      />

      <BookingRestaurantBillDialog
        bookingId={restaurantBillBookingId}
        guestLabel={restaurantBillGuestLabel}
        roomNumber={restaurantBillRoomNumber}
        open={restaurantBillDialogOpen}
        onOpenChange={(open) => {
          setRestaurantBillDialogOpen(open);
          if (!open) {
            setRestaurantBillBookingId(null);
            setRestaurantBillGuestLabel(undefined);
            setRestaurantBillRoomNumber(undefined);
            queryClient.invalidateQueries({ queryKey: ['rooms'] });
          }
        }}
      />
    </div>
  );
}
