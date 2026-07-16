'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { formatInvoiceNumberDisplay } from '@/lib/invoice-number'
import { useAuthStore, canAccessHotel } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import {
  FileText, Plus, Search, Filter, Printer, Eye, RefreshCw, X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import InvoiceDetail from './InvoiceDetail'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { DEFAULT_NATIONALITY } from '@/lib/id-type-label'
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration'
import {
  buildWalkInStay,
  combineDateAndTime,
  isStayDatetimeRangeValid,
  minCheckoutDatePickerValue,
  splitDateAndTime,
  toTimeInputValue,
} from '@/lib/hotel-times'

interface InvoiceItem {
  id: string
  itemType: string
  description: string
  quantity: number
  unitPrice: number
  total: number
}

interface Invoice {
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
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED'
  issuedAt: string | null
  paidAt: string | null
  createdAt: string
  booking: {
    id: string
    checkIn: string
    checkOut: string
    status: string
    customer: { id: string; name: string; phone: string; email: string | null }
    room: { id: string; roomNumber: string; type: { name: string } }
  }
  items: InvoiceItem[]
}

interface Booking {
  id: string
  checkIn: string
  checkOut: string
  status: string
  totalRoomCharge: number
  dueAmount?: number
  roomId: string
  registrationNumber?: string | null
  sourceReservationEntry?: { registrationNumber?: string | null } | null
  companyLedgerGuest?: { registrationNumber?: string | null } | null
  customer: {
    id: string
    name: string
    phone?: string
    email?: string | null
    address?: string | null
    nationality?: string | null
    idNumber?: string | null
    registrationNumber?: string | null
  }
  room: { id: string; roomNumber: string; totalPrice: number; type: { name: string } }
}

interface RoomOption {
  id: string
  roomNumber: string
  totalPrice: number
  type: { name: string }
}

type InvoiceFormState = {
  checkInDate: string
  checkInTime: string
  checkOutDate: string
  checkOutTime: string
  guestName: string
  guestPhone: string
  guestEmail: string
  guestAddress: string
  guestNationality: string
  guestIdNumber: string
  guestRegistrationNumber: string
  roomCharges: string
  foodCharges: string
  serviceCharges: string
  discount: string
  vatPercent: string
  paidAmount: string
}

const buildDefaultStayFields = (checkInTime: string, checkOutTime: string) => {
  const walkIn = buildWalkInStay(new Date(), { checkInTime, checkOutTime })
  const ci = splitDateAndTime(walkIn.checkIn, checkInTime)
  const co = splitDateAndTime(walkIn.checkOut, checkOutTime)
  return {
    checkInDate: ci.date,
    checkInTime: ci.time,
    checkOutDate: co.date,
    checkOutTime: co.time,
  }
}

const emptyInvoiceForm = (checkInTime: string, checkOutTime: string): InvoiceFormState => ({
  ...buildDefaultStayFields(checkInTime, checkOutTime),
  guestName: '',
  guestPhone: '',
  guestEmail: '',
  guestAddress: '',
  guestNationality: DEFAULT_NATIONALITY,
  guestIdNumber: '',
  guestRegistrationNumber: '',
  roomCharges: '',
  foodCharges: '',
  serviceCharges: '',
  discount: '',
  vatPercent: '0',
  paidAmount: '',
})

const statusColors: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground border-border',
  ISSUED: 'bg-sky-50 text-sky-700 border-sky-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
}

export default function InvoicesPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { times } = useHotelTimes()

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(() =>
    emptyInvoiceForm(times.checkInTime, times.checkOutTime)
  )
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

  const patchInvoiceForm = (patch: Partial<InvoiceFormState>) => {
    setInvoiceForm((prev) => ({ ...prev, ...patch }))
  }

  const resetGenerateForm = () => {
    setSelectedRoomId('')
    setInvoiceForm(emptyInvoiceForm(times.checkInTime, times.checkOutTime))
  }

  // Fetch invoices
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '20')
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await api.get<{ success: boolean; data: Invoice[]; meta?: { total: number; totalPages: number } }>(`/invoices?${params.toString()}`)
      return res
    },
    enabled: !!user && canAccessHotel(user?.role),
  })

  // Fetch rooms for invoice generation
  const { data: roomsData } = useQuery({
    queryKey: ['rooms-for-invoice'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RoomOption[] }>('/rooms?limit=200')
      return res
    },
    enabled: showGenerateDialog,
  })

  // Fetch bookings for invoice generation
  const { data: bookingsData } = useQuery({
    queryKey: ['bookings-for-invoice'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Booking[] }>(`/bookings?limit=200&status=CHECKED_IN`)
      return res
    },
    enabled: showGenerateDialog,
  })

  const { data: checkedOutData } = useQuery({
    queryKey: ['bookings-checked-out'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Booking[] }>(`/bookings?limit=200&status=CHECKED_OUT`)
      return res
    },
    enabled: showGenerateDialog,
  })

  const { data: reservedData } = useQuery({
    queryKey: ['bookings-reserved-invoice'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Booking[] }>(`/bookings?limit=200&status=RESERVED`)
      return res
    },
    enabled: showGenerateDialog,
  })

  // Generate invoice mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const checkIn = combineDateAndTime(invoiceForm.checkInDate, invoiceForm.checkInTime)
      const checkOut = combineDateAndTime(invoiceForm.checkOutDate, invoiceForm.checkOutTime)
      return api.post<{ success: boolean; data: Invoice; message?: string }>('/invoices', {
        roomId: selectedRoomId,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        roomCharges: parseFloat(invoiceForm.roomCharges) || 0,
        foodCharges: parseFloat(invoiceForm.foodCharges) || 0,
        extraCharges: parseFloat(invoiceForm.serviceCharges) || 0,
        discount: parseFloat(invoiceForm.discount) || 0,
        vatPercent: parseFloat(invoiceForm.vatPercent) || 0,
        paidAmount: parseFloat(invoiceForm.paidAmount) || 0,
        guest: {
          name: invoiceForm.guestName.trim(),
          phone: invoiceForm.guestPhone.trim(),
          email: invoiceForm.guestEmail.trim() || null,
          address: invoiceForm.guestAddress.trim() || null,
          nationality: invoiceForm.guestNationality.trim() || null,
          idNumber: invoiceForm.guestIdNumber.trim() || null,
          registrationNumber: invoiceForm.guestRegistrationNumber.trim() || null,
        },
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      toast({ title: 'Invoice Generated', description: res.message || 'Invoice created successfully' })
      setShowGenerateDialog(false)
      resetGenerateForm()
      if (res.data?.id) {
        window.open(`/invoice/${res.data.id}`, '_blank', 'noopener,noreferrer')
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to generate invoice', variant: 'destructive' })
    },
  })

  // Access check
  if (!user || !canAccessHotel(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only hotel team members and admins can access invoices.</p>
        </CardContent>
      </Card>
    )
  }

  const invoices = invoicesData?.data || []
  const totalPages = invoicesData?.meta?.totalPages || 1
  const allRooms = roomsData?.data || []
  const allBookings = [
    ...(bookingsData?.data || []),
    ...(checkedOutData?.data || []),
    ...(reservedData?.data || []),
  ]


  const applyBookingToForm = (booking: Booking) => {
    const c = booking.customer
    const ci = splitDateAndTime(booking.checkIn, times.checkInTime)
    const co = splitDateAndTime(booking.checkOut, times.checkOutTime)
    setInvoiceForm({
      checkInDate: ci.date,
      checkInTime: ci.time,
      checkOutDate: co.date,
      checkOutTime: co.time,
      guestName: c?.name || '',
      guestPhone: c?.phone || '',
      guestEmail: c?.email || '',
      guestAddress: c?.address || '',
      guestNationality: c?.nationality || DEFAULT_NATIONALITY,
      guestIdNumber: c?.idNumber || '',
      guestRegistrationNumber: resolveBookingRegistrationNumber(booking) || '',
      roomCharges: String(booking.totalRoomCharge ?? 0),
      foodCharges: '0',
      serviceCharges: '0',
      discount: '0',
      vatPercent: '0',
      paidAmount: String(Math.max(0, (booking.totalRoomCharge ?? 0) - (booking.dueAmount ?? booking.totalRoomCharge ?? 0))),
    })
  }

  const handleRoomChange = (roomId: string) => {
    setSelectedRoomId(roomId)
    const matches = allBookings.filter((b) => b.roomId === roomId || b.room?.id === roomId)
    const active =
      matches.find((b) => b.status === 'CHECKED_IN') ||
      matches.find((b) => b.status === 'RESERVED') ||
      matches[0]

    if (active) {
      applyBookingToForm(active)
      return
    }

    const room = allRooms.find((r) => r.id === roomId)
    setInvoiceForm({
      ...emptyInvoiceForm(times.checkInTime, times.checkOutTime),
      roomCharges: String(room?.totalPrice ?? 0),
    })
  }

  let stayRangeValid = false
  try {
    if (invoiceForm.checkInDate && invoiceForm.checkOutDate) {
      const checkIn = combineDateAndTime(invoiceForm.checkInDate, invoiceForm.checkInTime)
      const checkOut = combineDateAndTime(invoiceForm.checkOutDate, invoiceForm.checkOutTime)
      stayRangeValid = isStayDatetimeRangeValid(checkIn, checkOut)
    }
  } catch {
    stayRangeValid = false
  }

  const parsedRoom = parseFloat(invoiceForm.roomCharges) || 0
  const parsedFood = parseFloat(invoiceForm.foodCharges) || 0
  const parsedService = parseFloat(invoiceForm.serviceCharges) || 0
  const parsedDiscountRaw = parseFloat(invoiceForm.discount) || 0
  const parsedVat = parseFloat(invoiceForm.vatPercent) || 0
  // Discount is room-only; never reduce service/damage/extras.
  const parsedDiscount = Math.min(Math.max(0, parsedDiscountRaw), Math.max(0, parsedRoom))
  const taxableHotel = Math.max(0, parsedRoom - parsedDiscount) + Math.max(0, parsedService)
  const hotelVat = parsedVat > 0 ? (taxableHotel * parsedVat) / 100 : 0
  const estimatedTotal = Math.max(0, taxableHotel + hotelVat + parsedFood)
  const estimatedDue = Math.max(0, estimatedTotal - (parseFloat(invoiceForm.paidAmount) || 0))

  const filteredInvoices = invoices.filter((inv) => {
    const q = searchQuery.toLowerCase()
    return (
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.booking?.customer?.name?.toLowerCase().includes(q) ||
      inv.booking?.room?.roomNumber?.toLowerCase().includes(q)
    )
  })

  const canGenerate =
    !!selectedRoomId &&
    invoiceForm.guestName.trim().length > 0 &&
    invoiceForm.guestPhone.trim().length > 0 &&
    !!invoiceForm.checkInDate &&
    !!invoiceForm.checkOutDate &&
    stayRangeValid

  const handlePrint = (invoice: Invoice) => {
    window.open(`/invoice/${invoice.id}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-amber-600" />
            Invoices
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Manage hotel billing and invoices</p>
        </div>
        <Button
          onClick={() => setShowGenerateDialog(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Generate Invoice
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by invoice #, guest name, room..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="ISSUED">Issued</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['invoices'] })}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead className="text-right">Room Charges</TableHead>
                  <TableHead className="text-right">Food Charges</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filteredInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No invoices found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id} className="hover:bg-muted">
                      <TableCell className="font-mono text-sm font-medium">
                        {formatInvoiceNumberDisplay(invoice.invoiceNumber)}
                      </TableCell>
                      <TableCell>{invoice.booking?.customer?.name || 'N/A'}</TableCell>
                      <TableCell className="font-mono">{invoice.booking?.room?.roomNumber || 'N/A'}</TableCell>
                      <TableCell className="text-right">
                        ৳{invoice.roomCharges.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        ৳{invoice.foodCharges.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ৳{invoice.totalAmount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">
                        ৳{invoice.paidAmount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={invoice.dueAmount > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                          ৳{invoice.dueAmount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[invoice.status] || ''}>
                          {invoice.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedInvoice(invoice)}
                            title="View Detail"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePrint(invoice)}
                            title="Print"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="flex items-center px-3 text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Generate Invoice Dialog */}
      <Dialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          setShowGenerateDialog(open)
          if (!open) resetGenerateForm()
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Room & stay */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Room *</Label>
                <Select value={selectedRoomId} onValueChange={handleRoomChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select room" />
                  </SelectTrigger>
                  <SelectContent>
                    {allRooms.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        Room {room.roomNumber} — {room.type?.name} (৳{room.totalPrice?.toLocaleString()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4 rounded-md border p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-checkin-date">Check-in date</Label>
                    <Input
                      id="inv-checkin-date"
                      type="date"
                      className="erp-date-input w-full"
                      value={invoiceForm.checkInDate}
                      onChange={(e) => {
                        const nextIn = e.target.value
                        const patch: Partial<InvoiceFormState> = { checkInDate: nextIn }
                        const minOut = minCheckoutDatePickerValue(nextIn)
                        if (minOut && invoiceForm.checkOutDate && invoiceForm.checkOutDate <= nextIn) {
                          patch.checkOutDate = minOut
                        }
                        patchInvoiceForm(patch)
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-checkout-date">Check-out date</Label>
                    <Input
                      id="inv-checkout-date"
                      type="date"
                      className="erp-date-input w-full"
                      min={minCheckoutDatePickerValue(invoiceForm.checkInDate)}
                      value={invoiceForm.checkOutDate}
                      onChange={(e) => patchInvoiceForm({ checkOutDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:max-w-[11rem]">
                    <Label htmlFor="inv-checkin-time">Check-in time</Label>
                    <Input
                      id="inv-checkin-time"
                      type="time"
                      className="erp-time-input w-full"
                      value={toTimeInputValue(invoiceForm.checkInTime, times.checkInTime)}
                      onChange={(e) => patchInvoiceForm({ checkInTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:max-w-[11rem]">
                    <Label htmlFor="inv-checkout-time">Check-out time</Label>
                    <Input
                      id="inv-checkout-time"
                      type="time"
                      className="erp-time-input w-full"
                      value={toTimeInputValue(invoiceForm.checkOutTime, times.checkOutTime)}
                      onChange={(e) => patchInvoiceForm({ checkOutTime: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {!stayRangeValid && invoiceForm.checkInDate && invoiceForm.checkOutDate && (
                <p className="text-sm text-red-600">Check-out must be after check-in.</p>
              )}
            </div>

            {/* Guest details */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Guest details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-name">Name *</Label>
                  <Input
                    id="inv-guest-name"
                    value={invoiceForm.guestName}
                    onChange={(e) => patchInvoiceForm({ guestName: e.target.value })}
                    placeholder="Guest full name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-phone">Phone *</Label>
                  <Input
                    id="inv-guest-phone"
                    value={invoiceForm.guestPhone}
                    onChange={(e) => patchInvoiceForm({ guestPhone: e.target.value })}
                    placeholder="Phone number"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-email">Email</Label>
                  <Input
                    id="inv-guest-email"
                    type="email"
                    value={invoiceForm.guestEmail}
                    onChange={(e) => patchInvoiceForm({ guestEmail: e.target.value })}
                    placeholder="Email address"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-nationality">Nationality</Label>
                  <Input
                    id="inv-guest-nationality"
                    value={invoiceForm.guestNationality}
                    onChange={(e) => patchInvoiceForm({ guestNationality: e.target.value })}
                    placeholder="Nationality"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-id">ID number</Label>
                  <Input
                    id="inv-guest-id"
                    value={invoiceForm.guestIdNumber}
                    onChange={(e) => patchInvoiceForm({ guestIdNumber: e.target.value })}
                    placeholder="NID / Passport"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-guest-reg">Registration number</Label>
                  <Input
                    id="inv-guest-reg"
                    value={invoiceForm.guestRegistrationNumber}
                    onChange={(e) => patchInvoiceForm({ guestRegistrationNumber: e.target.value })}
                    placeholder="Guest registration #"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="inv-guest-address">Address</Label>
                  <Input
                    id="inv-guest-address"
                    value={invoiceForm.guestAddress}
                    onChange={(e) => patchInvoiceForm({ guestAddress: e.target.value })}
                    placeholder="Address"
                  />
                </div>
              </div>
            </div>

            {/* Charges */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Charges</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-room-charges">Room charges</Label>
                  <Input
                    id="inv-room-charges"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.roomCharges}
                    onChange={(e) => patchInvoiceForm({ roomCharges: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-food-charges">Food charges</Label>
                  <Input
                    id="inv-food-charges"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.foodCharges}
                    onChange={(e) => patchInvoiceForm({ foodCharges: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-service-charges">Service charges</Label>
                  <Input
                    id="inv-service-charges"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.serviceCharges}
                    onChange={(e) => patchInvoiceForm({ serviceCharges: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-discount">Discount</Label>
                  <Input
                    id="inv-discount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.discount}
                    onChange={(e) => patchInvoiceForm({ discount: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-vat">VAT %</Label>
                  <Input
                    id="inv-vat"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.vatPercent}
                    onChange={(e) => patchInvoiceForm({ vatPercent: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-paid">Paid amount</Label>
                  <Input
                    id="inv-paid"
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceForm.paidAmount}
                    onChange={(e) => patchInvoiceForm({ paidAmount: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Summary */}
            <Card className="border-amber-200 bg-amber-50/40">
              <CardContent className="p-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal (room + service + food)</span>
                  <span>৳{(parsedRoom + parsedService + parsedFood).toLocaleString()}</span>
                </div>
                {parsedDiscount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Discount</span>
                    <span>-৳{parsedDiscount.toLocaleString()}</span>
                  </div>
                )}
                {parsedVat > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT ({parsedVat}%)</span>
                    <span>৳{hotelVat.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-base pt-1 border-t border-amber-200">
                  <span>Total</span>
                  <span>৳{estimatedTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due</span>
                  <span className={estimatedDue > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                    ৳{estimatedDue.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate || generateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {generateMutation.isPending ? 'Generating...' : 'Generate Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Detail Dialog */}
      <Dialog open={!!selectedInvoice && !showGenerateDialog} onOpenChange={(open) => { if (!open) setSelectedInvoice(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {selectedInvoice
                ? `Invoice ${formatInvoiceNumberDisplay(selectedInvoice.invoiceNumber)}`
                : 'Invoice details'}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <InvoiceDetail
              invoiceId={selectedInvoice.id}
              onClose={() => setSelectedInvoice(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
