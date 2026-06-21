'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from 'sonner'
import {
  Plus,
  Minus,
  Trash2,
  Coffee,
  User,
  BedDouble,
  ShoppingBag,
  Send,
  History,
  List,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PosLiveSearchField } from '@/components/erp/restaurant/PosLiveSearchField'
import { PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import { openHotelBeverageReceiptTab } from '@/lib/hotel-beverage-receipt-navigation'
import { formatBdt } from '@/lib/currency'
import { HotelBeverageAllSalesDialog } from '@/components/erp/hotel/HotelBeverageAllSalesDialog'

type BeverageCategory = {
  id: string
  name: string
  sortOrder: number
  itemCount: number
}

type BeverageMenuItem = {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  image: string | null
  available: boolean
  isVeg: boolean
  category: { id: string; name: string }
}

type OccupiedRoom = {
  room_id: string
  room_number: string
  room_type: string
  current_booking_id: string | null
}

type CartItem = {
  menuItem: BeverageMenuItem
  quantity: number
}

type RecentSale = {
  id: string
  saleNumber: string
  saleType: 'WALK_IN' | 'ROOM'
  totalAmount: number
  customerName: string | null
  room?: { roomNumber: string } | null
  createdAt: string
}

type SaleMode = 'WALK_IN' | 'ROOM'

function buildFoodPlaceholderSrc(itemId: string, itemName: string, width: number, height: number) {
  const params = new URLSearchParams({
    seed: itemId,
    name: itemName,
    w: String(width),
    h: String(height),
  })
  return `/api/placeholder/food?${params.toString()}`
}

function normalizeMenuImageSrc(image: string | null | undefined) {
  const raw = image?.trim()
  if (!raw) return null
  if (
    raw.startsWith('data:image/') ||
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('/')
  ) {
    return raw
  }
  return `/${raw.replace(/^\.?\//, '')}`
}

function MenuItemImage({
  item,
  width,
  height,
  className,
}: {
  item: Pick<BeverageMenuItem, 'id' | 'name' | 'image'>
  width: number
  height: number
  className: string
}) {
  const fallbackSrc = buildFoodPlaceholderSrc(item.id, item.name, width, height)
  const preferredSrc = normalizeMenuImageSrc(item.image) || fallbackSrc
  const [src, setSrc] = useState(preferredSrc)

  useEffect(() => {
    setSrc(preferredSrc)
  }, [preferredSrc])

  return (
    <Image
      src={src}
      alt={item.name}
      width={width}
      height={height}
      className={className}
      unoptimized
      onError={() => {
        if (src !== fallbackSrc) setSrc(fallbackSrc)
      }}
    />
  )
}

export function HotelBeverageSalesPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  const [now, setNow] = useState(() => new Date())
  const [saleMode, setSaleMode] = useState<SaleMode>('WALK_IN')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [quantityDialogItem, setQuantityDialogItem] = useState<BeverageMenuItem | null>(null)
  const [quantityDialogQty, setQuantityDialogQty] = useState(1)
  const quantityPanelRef = useRef<HTMLDivElement>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [roomId, setRoomId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [allSalesOpen, setAllSalesOpen] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const { data: menuRes, isLoading: menuLoading } = useQuery({
    queryKey: ['hotel-beverage-menu'],
    queryFn: () =>
      api.get<{
        success: boolean
        data: { items: BeverageMenuItem[]; categories: BeverageCategory[] }
      }>('/hotel-beverage-sales/menu-items'),
  })

  const { data: roomsRes, isLoading: roomsLoading } = useQuery({
    queryKey: ['occupied-rooms-beverage'],
    queryFn: () => api.get<{ success: boolean; data: OccupiedRoom[] }>('/occupied-rooms'),
    enabled: saleMode === 'ROOM',
  })

  const { data: recentRes, isLoading: recentLoading } = useQuery({
    queryKey: ['hotel-beverage-sales-recent'],
    queryFn: () =>
      api.get<{ success: boolean; data: RecentSale[] }>('/hotel-beverage-sales?limit=15'),
    enabled: recentOpen,
  })

  const beverageItems = menuRes?.data?.items ?? []
  const categories = menuRes?.data?.categories ?? []
  const occupiedRooms = (roomsRes?.data ?? []).filter((r) => r.current_booking_id)
  const recentSales = recentRes?.data ?? []

  const roomReady = saleMode !== 'ROOM' || Boolean(roomId)
  const selectedRoom = occupiedRooms.find((r) => r.room_id === roomId)

  const filteredItems = useMemo(() => {
    let items = beverageItems.filter((item) => item.available)
    if (selectedCategory !== 'all') {
      items = items.filter((item) => item.categoryId === selectedCategory)
    }
    return items
  }, [beverageItems, selectedCategory])

  const subtotal = cart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0)

  const filterMenuItem = useCallback((item: BeverageMenuItem, query: string) => {
    const q = query.toLowerCase()
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q) ?? false) ||
      item.category.name.toLowerCase().includes(q)
    )
  }, [])

  const filterOccupiedRoom = useCallback((room: OccupiedRoom, query: string) => {
    const q = query.toLowerCase()
    return (
      room.room_number.toLowerCase().includes(q) ||
      room.room_type.toLowerCase().includes(q)
    )
  }, [])

  const guardItemSelection = useCallback(() => {
    if (saleMode === 'ROOM' && !roomId) {
      toast.error('Select a room first', {
        description: 'Search and choose a checked-in room on the right panel.',
      })
      return false
    }
    return true
  }, [saleMode, roomId])

  const addToCartWithQuantity = useCallback((menuItem: BeverageMenuItem, quantity: number) => {
    if (quantity < 1) return
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === menuItem.id)
      if (existing) {
        return prev.map((c) =>
          c.menuItem.id === menuItem.id ? { ...c, quantity: c.quantity + quantity } : c
        )
      }
      return [...prev, { menuItem, quantity }]
    })
  }, [])

  const openQuantityDialog = useCallback(
    (menuItem: BeverageMenuItem) => {
      if (!guardItemSelection()) return
      setQuantityDialogItem(menuItem)
      setQuantityDialogQty(1)
    },
    [guardItemSelection]
  )

  const closeQuantityDialog = useCallback(() => {
    setQuantityDialogItem(null)
    setQuantityDialogQty(1)
  }, [])

  const confirmQuantityDialog = useCallback(() => {
    if (!quantityDialogItem || quantityDialogQty < 1) return
    addToCartWithQuantity(quantityDialogItem, quantityDialogQty)
    toast.success(`Added ${quantityDialogQty}× ${quantityDialogItem.name}`)
    closeQuantityDialog()
  }, [quantityDialogItem, quantityDialogQty, addToCartWithQuantity, closeQuantityDialog])

  const handleQuantityDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setQuantityDialogQty((q) => q + 1)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setQuantityDialogQty((q) => Math.max(1, q - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirmQuantityDialog()
      }
    },
    [confirmQuantityDialog]
  )

  const updateQuantity = useCallback((menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.menuItem.id === menuItemId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    )
  }, [])

  const removeFromCart = useCallback((menuItemId: string) => {
    setCart((prev) => prev.filter((c) => c.menuItem.id !== menuItemId))
  }, [])

  const clearCart = useCallback(() => {
    setCart([])
    setNotes('')
    setShowNotes(false)
  }, [])

  const clearSaleForm = useCallback(() => {
    clearCart()
    setCustomerName('')
    setCustomerPhone('')
    setRoomId('')
    setPaymentMethod('CASH')
  }, [clearCart])

  const saleMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{ success: boolean; data: { id: string; saleNumber: string }; error?: string }>(
        '/hotel-beverage-sales',
        payload
      ),
    onSuccess: (res, variables) => {
      if (!res?.success || !res.data?.id) {
        toast.error(res?.error || 'Sale failed')
        return
      }

      queryClient.invalidateQueries({ queryKey: ['hotel-beverage-sales-recent'] })
      queryClient.invalidateQueries({ queryKey: ['hotel-beverage-sales-all'] })
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })

      const type = variables.saleType as string
      if (type === 'WALK_IN') {
        toast.success(`Walk-in sale ${res.data.saleNumber} recorded`)
        openHotelBeverageReceiptTab(res.data.id, { autoPrint: true })
      } else {
        const room = occupiedRooms.find((r) => r.room_id === variables.roomId)
        toast.success(
          `Room ${room?.room_number ?? ''} charged — beverages will appear on the guest invoice`
        )
      }

      clearSaleForm()
    },
    onError: (err: Error) => toast.error(err.message || 'Sale failed'),
  })

  const handleCompleteSale = () => {
    if (cart.length === 0) {
      toast.error('Cart is empty', { description: 'Add beverage items to continue.' })
      return
    }

    if (saleMode === 'WALK_IN') {
      saleMutation.mutate({
        saleType: 'WALK_IN',
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        paymentMethod,
        notes: notes.trim() || undefined,
        items: cart.map((c) => ({
          menuItemId: c.menuItem.id,
          quantity: c.quantity,
        })),
      })
      return
    }

    const room = occupiedRooms.find((r) => r.room_id === roomId)
    if (!room?.current_booking_id) {
      toast.error('Select a checked-in room')
      return
    }

    saleMutation.mutate({
      saleType: 'ROOM',
      roomId: room.room_id,
      bookingId: room.current_booking_id,
      notes: notes.trim() || undefined,
      items: cart.map((c) => ({
        menuItemId: c.menuItem.id,
        quantity: c.quantity,
      })),
    })
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] bg-muted overflow-hidden -m-4 md:-m-6">
      {/* Left — beverage menu (POS-style) */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Coffee className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">RRP Dream Inn</h1>
              <p className="text-xs text-slate-300">Hotel Beverage POS</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 border border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-700 hover:text-white"
              onClick={() => setRecentOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              Recent
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 border border-emerald-600/60 bg-emerald-600/20 text-emerald-100 hover:bg-emerald-600/35 hover:text-white"
              onClick={() => setAllSalesOpen(true)}
            >
              <List className="h-3.5 w-3.5" />
              All sales
            </Button>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-xs">
              {user?.name || 'Staff'}
            </Badge>
            <div className="text-right">
              <div className="text-xs text-slate-200">
                {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-[11px] text-slate-300">
                {now.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 bg-card border-b shrink-0">
          <PosLiveSearchField
            placeholder={
              saleMode === 'ROOM' && !roomReady
                ? 'Select a checked-in room first, then search beverages…'
                : 'Search beverages… (↑↓ navigate, Enter to select)'
            }
            items={beverageItems}
            isLoading={menuLoading}
            disabled={saleMode === 'ROOM' && !roomReady}
            getItemId={(item) => item.id}
            getItemLabel={(item) => item.name}
            getItemSublabel={(item) =>
              `${item.category.name} · ৳${item.price.toFixed(0)}`
            }
            filterItem={filterMenuItem}
            onSelect={openQuantityDialog}
            emptyMessage="No beverage items available"
            noResultsMessage="No beverages match your search"
            maxResults={20}
            overlayDropdown
            inputClassName="h-10 pl-10 bg-muted border-border"
          />
        </div>

        <div className="px-4 py-2 bg-card border-b shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <Button
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('all')}
              className={
                selectedCategory === 'all'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shrink-0'
                  : 'shrink-0'
              }
            >
              All
            </Button>
            {menuLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-24 shrink-0" />
                ))
              : categories.map((cat) => (
                  <Button
                    key={cat.id}
                    variant={selectedCategory === cat.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={
                      selectedCategory === cat.id
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shrink-0'
                        : 'shrink-0'
                    }
                  >
                    {cat.name}
                    <span className="ml-1.5 text-xs opacity-60">({cat.itemCount})</span>
                  </Button>
                ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] hover:[scrollbar-width:thin]">
          {menuLoading ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Coffee className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No beverage items found</p>
              <p className="text-xs mt-1">Add items under a Beverages category in Menu Management</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.menuItem.id === item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openQuantityDialog(item)}
                    disabled={saleMode === 'ROOM' && !roomReady}
                    className={`text-left bg-card rounded-lg border-2 p-2 transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed ${
                      inCart
                        ? 'border-emerald-400 shadow-sm bg-emerald-50/50'
                        : 'border-border hover:border-emerald-200'
                    }`}
                  >
                    <div className="mb-1.5 overflow-hidden rounded-md border border-border bg-muted">
                      <MenuItemImage
                        item={item}
                        width={360}
                        height={220}
                        className="h-14 w-full object-cover"
                      />
                    </div>
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span
                            className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${
                              item.isVeg
                                ? 'border-green-600 bg-green-500'
                                : 'border-red-600 bg-red-500'
                            }`}
                          />
                          <h3 className="font-semibold text-xs text-foreground truncate">
                            {item.name}
                          </h3>
                        </div>
                      </div>
                      {inCart && (
                        <Badge className="bg-emerald-500 text-white text-[9px] shrink-0 h-4 min-w-4 flex items-center justify-center px-1">
                          {inCart.quantity}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-emerald-700 font-bold text-xs">
                        ৳{item.price.toFixed(0)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right — order panel */}
      <div className="w-[380px] bg-card border-l flex flex-col shrink-0 shadow-xl h-full max-h-full overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base">Current Sale</h2>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCart}
                className="text-slate-300 hover:text-red-400 hover:bg-transparent h-7 text-xs"
              >
                Clear All
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {[
              { mode: 'WALK_IN' as SaleMode, icon: User, label: 'Walk-in' },
              { mode: 'ROOM' as SaleMode, icon: BedDouble, label: 'Room' },
            ].map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setSaleMode(mode)
                  if (mode === 'WALK_IN') setRoomId('')
                }}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                  saleMode === mode
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-b bg-muted shrink-0 space-y-3">
          {saleMode === 'ROOM' && (
            <PosLiveSearchField
              label="Checked-in room *"
              placeholder="Search room number or type…"
              selectedId={roomId}
              selectedLabel={
                selectedRoom
                  ? `Room ${selectedRoom.room_number} (${selectedRoom.room_type})`
                  : undefined
              }
              items={occupiedRooms}
              isLoading={roomsLoading}
              getItemId={(r) => r.room_id}
              getItemLabel={(r) => `Room ${r.room_number}`}
              getItemSublabel={(r) => r.room_type}
              filterItem={filterOccupiedRoom}
              onSelect={(r) => setRoomId(r.room_id)}
              onClear={() => setRoomId('')}
              emptyMessage="No checked-in rooms"
              noResultsMessage="No rooms match your search"
            />
          )}

          {saleMode === 'WALK_IN' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Customer name
                  </label>
                  <Input
                    placeholder="Optional"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Phone
                  </label>
                  <Input
                    placeholder="Optional"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Payment method *
                </label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.filter((m) => m.value !== 'NONE').map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {saleMode === 'ROOM' && roomId && (
            <p className="text-[11px] text-muted-foreground">
              Charges post to the guest folio and appear on the room invoice at checkout.
            </p>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          <div className="p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ShoppingBag className="w-10 h-10 mb-2" />
                <p className="text-sm">No items in cart</p>
                <p className="text-xs mt-1 text-center px-4">
                  {saleMode === 'ROOM' && !roomReady
                    ? 'Select a room, then tap beverages or search'
                    : 'Tap beverages or use search to add'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.menuItem.id}
                    className="flex items-start gap-2 p-2.5 bg-muted rounded-lg border border-border"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full border mt-1.5 shrink-0 ${
                        item.menuItem.isVeg
                          ? 'border-green-600 bg-green-500'
                          : 'border-red-600 bg-red-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.menuItem.name}
                      </p>
                      <p className="text-xs text-emerald-700 font-semibold">
                        ৳{(item.menuItem.price * item.quantity).toFixed(0)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.menuItem.id, -1)}
                      >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.menuItem.id, 1)}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => removeFromCart(item.menuItem.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t bg-card shrink-0">
          {cart.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex justify-end items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Notes</span>
                <Switch
                  checked={showNotes}
                  onCheckedChange={setShowNotes}
                  className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-slate-300"
                />
              </div>
            </div>
          )}
          {cart.length > 0 && showNotes && (
            <div className="px-4 pt-3">
              <Textarea
                placeholder="Optional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-16 text-xs resize-none"
              />
            </div>
          )}

          <div className="px-4 py-3">
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-emerald-700">{formatBdt(subtotal)}</span>
            </div>
          </div>

          <div className="px-4 pb-4">
            <Button
              onClick={handleCompleteSale}
              disabled={cart.length === 0 || saleMutation.isPending}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base gap-2 disabled:opacity-50"
            >
              {saleMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing…
                </>
              ) : saleMode === 'WALK_IN' ? (
                <>
                  <Send className="w-4 h-4" />
                  Complete & print ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </>
              ) : (
                <>
                  <BedDouble className="w-4 h-4" />
                  Charge to room ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Quantity dialog */}
      <Dialog
        open={quantityDialogItem != null}
        onOpenChange={(open) => {
          if (!open) closeQuantityDialog()
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDownCapture={handleQuantityDialogKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            quantityPanelRef.current?.focus()
          }}
        >
          <div ref={quantityPanelRef} tabIndex={-1} className="outline-none space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-6">
                <span
                  className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                    quantityDialogItem?.isVeg
                      ? 'border-green-600 bg-green-500'
                      : 'border-red-600 bg-red-500'
                  }`}
                />
                {quantityDialogItem?.name}
              </DialogTitle>
            </DialogHeader>

            {quantityDialogItem && (
              <>
                <div className="overflow-hidden rounded-lg border border-border bg-muted">
                  <MenuItemImage
                    item={quantityDialogItem}
                    width={400}
                    height={240}
                    className="h-36 w-full object-cover"
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{quantityDialogItem.category.name}</span>
                  <span className="font-semibold text-emerald-700">
                    ৳{quantityDialogItem.price.toFixed(0)} each
                  </span>
                </div>
                <div className="flex items-center justify-center gap-4 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    disabled={quantityDialogQty <= 1}
                    onClick={() => setQuantityDialogQty((q) => Math.max(1, q - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[3rem] text-center text-2xl font-bold tabular-nums">
                    {quantityDialogQty}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setQuantityDialogQty((q) => q + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Line total:{' '}
                  <span className="font-semibold text-foreground">
                    ৳{(quantityDialogItem.price * quantityDialogQty).toFixed(0)}
                  </span>
                </p>
              </>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeQuantityDialog}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={confirmQuantityDialog}
              >
                Add to cart
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recent sales */}
      <Dialog open={recentOpen} onOpenChange={setRecentOpen}>
        <DialogContent className="flex flex-col gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh]">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>Recent beverage sales</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 max-h-[60vh]">
            <div className="px-6 py-2">
              {recentLoading ? (
                <div className="space-y-2 py-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : recentSales.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No sales yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Sale #</th>
                        <th className="py-2 pr-3 font-medium">Type</th>
                        <th className="py-2 pr-3 font-medium">Guest / Room</th>
                        <th className="py-2 pr-3 font-medium text-right">Amount</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {recentSales.map((sale) => (
                        <tr key={sale.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs">{sale.saleNumber}</td>
                          <td className="py-2 pr-3">
                            <Badge
                              variant="outline"
                              className={
                                sale.saleType === 'ROOM'
                                  ? 'border-sky-300 bg-sky-50 text-sky-800'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              }
                            >
                              {sale.saleType === 'ROOM' ? 'Room' : 'Walk-in'}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3">
                            {sale.saleType === 'ROOM'
                              ? sale.room?.roomNumber
                                ? `Room ${sale.room.roomNumber}`
                                : '—'
                              : sale.customerName || 'Walk-in'}
                          </td>
                          <td className="py-2 pr-3 text-right font-medium text-emerald-700">
                            {formatBdt(sale.totalAmount)}
                          </td>
                          <td className="py-2">
                            {sale.saleType === 'WALK_IN' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs shrink-0"
                                onClick={() => openHotelBeverageReceiptTab(sale.id)}
                              >
                                Receipt
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="px-6 py-3 border-t shrink-0 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              onClick={() => {
                setRecentOpen(false)
                setAllSalesOpen(true)
              }}
            >
              View all sales…
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <HotelBeverageAllSalesDialog open={allSalesOpen} onOpenChange={setAllSalesOpen} />
    </div>
  )
}
