'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from 'sonner'
import {
  Plus,
  Minus,
  Trash2,
  UtensilsCrossed,
  ShoppingBag,
  BedDouble,
  CreditCard,
  Clock,
  Flame,
  Leaf,
  ChefHat,
  Send,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
import { PosLiveSearchField } from './PosLiveSearchField'
import { useBusinessDate } from '@/hooks/use-business-date'
import { RestaurantOrderDeliveredActions } from './RestaurantOrderDeliveredActions'
import { RestaurantOrderPaymentSummary } from './RestaurantOrderPaymentSummary'
import {
  RestaurantOrderPaymentDialog,
  type RestaurantOrderPaymentTarget,
} from './RestaurantOrderPaymentDialog'
import { isRoomServiceGuestOrder } from '@/lib/restaurant-order-billing'
import { cn } from '@/lib/utils'

// Types
interface MenuCategory {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  itemCount: number
}

interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  image: string | null
  available: boolean
  isVeg: boolean
  preparationTime: number | null
  category: { id: string; name: string }
}

interface OccupiedRoom {
  room_id: string
  room_number: string
  room_type: string
  current_booking_id: string | null
}

interface RestaurantTable {
  id: string
  tableNumber: string
  capacity: number
  status: string
  location: string | null
}

interface RestaurantWaiter {
  id: string
  name: string
  phone: string | null
  role?: string
}

interface CartItem {
  menuItem: MenuItem
  quantity: number
}

type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE'
type DiscountType = 'PERCENTAGE' | 'AMOUNT'
type PosOrderStatus = 'PENDING' | 'COOKING' | 'READY' | 'DELIVERED'

interface PosOrderItem {
  id: string
  quantity: number
  menuItem: { id: string; name: string; price: number; isVeg: boolean }
}

interface PosOrder {
  id: string
  orderNumber: string
  orderType: OrderType
  status: PosOrderStatus
  customerName: string | null
  totalAmount: number
  notes: string | null
  createdAt: string
  bookingId?: string | null
  billingDisposition?: 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT'
  items: PosOrderItem[]
  payments?: { amount: number; paymentType: string; settlementSource?: string | null }[]
  companyLedgerBill?: { id: string } | null
  room: { roomNumber: string } | null
  table: { tableNumber: string } | null
  booking?: { id: string } | null
}

const POS_STATUS_STEPS: {
  key: PosOrderStatus
  label: string
  icon: typeof Clock
  className: string
  panelTitle: string
}[] = [
  {
    key: 'PENDING',
    label: 'Pending',
    icon: Clock,
    className: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
    panelTitle: "Today's Pending Orders",
  },
  {
    key: 'COOKING',
    label: 'Cooking',
    icon: Flame,
    className: 'border-orange-400/40 bg-orange-500/10 text-orange-300',
    panelTitle: "Today's Cooking Orders",
  },
  {
    key: 'READY',
    label: 'Ready',
    icon: CheckCircle2,
    className: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
    panelTitle: "Today's Ready Orders",
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    icon: CheckCircle2,
    className: 'border-slate-400/40 bg-slate-500/10 text-slate-200',
    panelTitle: "Today's Delivered Orders",
  },
]

const POS_STATUS_NEXT: Record<
  PosOrderStatus,
  { next: PosOrderStatus | null; label: string; buttonClass: string }
> = {
  PENDING: { next: 'COOKING', label: 'Start Cooking', buttonClass: 'bg-amber-600 hover:bg-amber-700' },
  COOKING: { next: 'READY', label: 'Mark Ready', buttonClass: 'bg-orange-600 hover:bg-orange-700' },
  READY: { next: 'DELIVERED', label: 'Mark Delivered', buttonClass: 'bg-emerald-600 hover:bg-emerald-700' },
  DELIVERED: { next: null, label: '', buttonClass: '' },
}

const POS_ORDER_TYPE_ICON: Record<OrderType, { icon: typeof UtensilsCrossed; label: string }> = {
  DINE_IN: { icon: UtensilsCrossed, label: 'Dine-in' },
  TAKEAWAY: { icon: ShoppingBag, label: 'Takeaway' },
  ROOM_SERVICE: { icon: BedDouble, label: 'Room Svc' },
}

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
  item: Pick<MenuItem, 'id' | 'name' | 'image'>
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

export default function POSPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  // State
  const [now, setNow] = useState(() => new Date())
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [quantityDialogItem, setQuantityDialogItem] = useState<MenuItem | null>(null)
  const [quantityDialogQty, setQuantityDialogQty] = useState(1)
  const quantityPanelRef = useRef<HTMLDivElement>(null)
  const [orderType, setOrderType] = useState<OrderType>('ROOM_SERVICE')
  const [tableId, setTableId] = useState<string>('')
  const [roomId, setRoomId] = useState<string>('')
  const [waiterId, setWaiterId] = useState<string>('')
  const [roomServiceStep, setRoomServiceStep] = useState<1 | 2 | 3>(1)
  const [roomServiceSetupComplete, setRoomServiceSetupComplete] = useState(false)
  const [roomServiceSummaryExpanded, setRoomServiceSummaryExpanded] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [discount, setDiscount] = useState<number>(0)
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENTAGE')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [activeStatusPanel, setActiveStatusPanel] = useState<PosOrderStatus | null>(null)
  const [payTarget, setPayTarget] = useState<{
    order: RestaurantOrderPaymentTarget
    roomGuest: boolean
  } | null>(null)
  const [payDialogOpen, setPayDialogOpen] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Fetch menu categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => api.get<{ success: boolean; data: MenuCategory[] }>('/menu-categories'),
  })
  const categories = categoriesData?.data || []

  // Fetch menu items (all, for POS we want all available)
  const { data: menuItemsData, isLoading: menuLoading } = useQuery({
    queryKey: ['menu-items-pos', 'all'],
    queryFn: () =>
      api.get<{ success: boolean; data: MenuItem[]; meta?: { total: number } }>(
        '/menu-items?limit=200&available=true'
      ),
  })
  const menuItems = menuItemsData?.data || []

  const { data: businessDateRes } = useBusinessDate()
  const businessDate = businessDateRes?.data?.businessDate

  // Room service: only guests checked in on the current business day
  const { data: occupiedRoomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['occupied-rooms', 'pos-business-day', businessDate],
    queryFn: () =>
      api.get<{ success: boolean; data: OccupiedRoom[] }>(
        '/occupied-rooms?businessDayCheckIn=1'
      ),
    enabled: orderType === 'ROOM_SERVICE' && !!businessDate,
  })
  const occupiedRooms = (occupiedRoomsData?.data ?? []).filter((r) => r.current_booking_id)

  // Fetch restaurant tables (dine-in + room service)
  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ['restaurant-tables'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantTable[] }>('/restaurant-tables'),
    enabled: orderType === 'DINE_IN' || orderType === 'ROOM_SERVICE',
  })
  const tables = tablesData?.data || []

  const { data: waitersData, isLoading: waitersLoading } = useQuery({
    queryKey: ['restaurant-waiters', 'pos'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantWaiter[] }>('/restaurant-waiters?forPos=1'),
    enabled: orderType === 'ROOM_SERVICE',
  })
  const waiters = waitersData?.data || []

  const { data: todayStatsData } = useQuery({
    queryKey: ['restaurant-orders', 'stats', 'today'],
    queryFn: () =>
      api.get<{
        success: boolean
        data: {
          date: string
          counts: { PENDING: number; COOKING: number; READY: number; DELIVERED: number }
        }
      }>('/restaurant-orders/stats/today'),
    enabled: !!user,
    refetchInterval: 15_000,
  })
  const todayOrderCounts = todayStatsData?.data?.counts ?? {
    PENDING: 0,
    COOKING: 0,
    READY: 0,
    DELIVERED: 0,
  }

  const { data: statusOrdersData, isLoading: statusOrdersLoading } = useQuery({
    queryKey: ['pos-today-orders', activeStatusPanel],
    queryFn: () =>
      api.get<{ success: boolean; data: PosOrder[] }>(
        `/restaurant-orders?status=${activeStatusPanel}&today=1&limit=100`
      ),
    enabled: !!activeStatusPanel,
    refetchInterval: activeStatusPanel ? 10_000 : false,
  })
  const statusPanelOrders = statusOrdersData?.data ?? []

  const statusUpdateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PosOrderStatus }) =>
      api.patch(`/restaurant-orders/${id}/status`, { status }),
    onSuccess: (_, variables) => {
      const updatedLabels: Partial<Record<PosOrderStatus, string>> = {
        COOKING: 'moved to Cooking',
        READY: 'marked as Ready',
        DELIVERED: 'marked as Delivered',
      }
      toast.success(`Order ${updatedLabels[variables.status] ?? 'updated'}`)
      queryClient.invalidateQueries({ queryKey: ['pos-today-orders'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders', 'stats', 'today'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to update order', { description: error.message })
    },
  })

  const sendToHotelMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/restaurant-orders/${orderId}/send-to-hotel`, {}),
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to send to hotel')
        return
      }
      toast.success(res.message || 'Order sent to hotel billing')
      queryClient.invalidateQueries({ queryKey: ['pos-today-orders'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to send to hotel', { description: error.message })
    },
  })

  const activeStatusPanelMeta = POS_STATUS_STEPS.find((s) => s.key === activeStatusPanel)

  // Place order mutation
  const placeOrderMutation = useMutation({
    mutationFn: (orderData: Record<string, unknown>) =>
      api.post<{ success: boolean; data: unknown; message?: string }>('/restaurant-orders', orderData),
    onSuccess: () => {
      toast.success('Order placed successfully!', {
        description: 'The order has been sent to the kitchen.',
      })
      // Clear cart and form
      setCart([])
      setDiscount(0)
      setDiscountType('PERCENTAGE')
      setNotes('')
      setShowNotes(false)
      setTableId('')
      setRoomId('')
      setWaiterId('')
      setRoomServiceStep(1)
      setRoomServiceSetupComplete(false)
      setCustomerName('')
      setCustomerPhone('')
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders', 'stats', 'today'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-tables'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to place order', {
        description: error.message || 'Please try again.',
      })
    },
  })

  // Filter menu items (category only — text search uses the dropdown)
  const filteredItems = useMemo(() => {
    let items = menuItems.filter((item) => item.available)
    if (selectedCategory !== 'all') {
      items = items.filter((item) => item.categoryId === selectedCategory)
    }
    return items
  }, [menuItems, selectedCategory])

  const availableMenuItems = useMemo(
    () => menuItems.filter((item) => item.available),
    [menuItems]
  )

  // Cart operations
  const addToCartWithQuantity = useCallback((menuItem: MenuItem, quantity: number) => {
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

  const roomServiceReady =
    orderType !== 'ROOM_SERVICE' ||
    (roomServiceSetupComplete && !!(roomId && waiterId && tableId))

  const guardFoodSelection = useCallback(() => {
    if (orderType === 'ROOM_SERVICE' && !roomServiceReady) {
      toast.error('Complete room service setup', {
        description: 'Use Next on the right panel to finish room, waiter, and table.',
      })
      return false
    }
    return true
  }, [orderType, roomServiceReady])

  const resetRoomServiceSetup = useCallback(() => {
    setRoomId('')
    setWaiterId('')
    setTableId('')
    setRoomServiceStep(1)
    setRoomServiceSetupComplete(false)
    setRoomServiceSummaryExpanded(false)
  }, [])

  const handleRoomServiceNext = () => {
    if (roomServiceStep === 1) {
      if (!roomId) {
        toast.error('Select a room', {
          description: 'Choose a room with check-in on today’s business day.',
        })
        return
      }
      setRoomServiceStep(2)
      return
    }
    if (roomServiceStep === 2) {
      if (!waiterId) {
        toast.error('Select a waiter', { description: 'Choose a waiter to continue.' })
        return
      }
      setRoomServiceStep(3)
      return
    }
    if (roomServiceStep === 3) {
      if (!tableId) {
        toast.error('Select a table', { description: 'Choose a table to finish setup.' })
        return
      }
      setRoomServiceSetupComplete(true)
      setRoomServiceSummaryExpanded(false)
      toast.success('Room service ready', { description: 'You can now add food items.' })
    }
  }

  const handleRoomServiceBack = () => {
    if (roomServiceStep === 3) {
      setTableId('')
      setRoomServiceStep(2)
      return
    }
    if (roomServiceStep === 2) {
      setWaiterId('')
      setTableId('')
      setRoomServiceStep(1)
    }
  }

  const openQuantityDialog = useCallback((menuItem: MenuItem) => {
    if (!guardFoodSelection()) return
    setQuantityDialogItem(menuItem)
    setQuantityDialogQty(1)
  }, [guardFoodSelection])

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
    setDiscount(0)
    setDiscountType('PERCENTAGE')
    setNotes('')
    setShowNotes(false)
  }, [])

  const { data: restaurantSettings } = useQuery({
    queryKey: ['restaurant-settings'],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean
        data: { vatPercent: number; restaurantName: string }
      }>('/settings/restaurant')
      return res.data
    },
    enabled: !!user,
    staleTime: 60_000,
  })

  // Calculations
  const subtotal = cart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0)
  const vatPercent = restaurantSettings?.vatPercent ?? 15
  const discountAmount =
    discountType === 'PERCENTAGE'
      ? (subtotal * Math.max(0, Math.min(100, discount))) / 100
      : Math.max(0, Math.min(subtotal, discount))
  const vatAmount = ((subtotal - discountAmount) * vatPercent) / 100
  const totalAmount = subtotal - discountAmount + vatAmount

  // Place order
  const handlePlaceOrder = () => {
    if (cart.length === 0) {
      toast.error('Cart is empty', { description: 'Please add items to the order.' })
      return
    }

    if (orderType === 'DINE_IN' && !tableId) {
      toast.error('Table required', { description: 'Please select a table for dine-in orders.' })
      return
    }

    if (orderType === 'ROOM_SERVICE' && !roomServiceReady) {
      toast.error('Complete room service setup', {
        description: 'Finish all steps (room, waiter, table) before placing the order.',
      })
      return
    }

    if (orderType === 'TAKEAWAY' && !customerName.trim()) {
      toast.error('Customer name required', { description: 'Please enter customer name for takeaway orders.' })
      return
    }

    if (discountType === 'PERCENTAGE' && discount > 100) {
      toast.error('Invalid discount', { description: 'Discount percentage cannot exceed 100%.' })
      return
    }
    if (discountType === 'AMOUNT' && discount > subtotal) {
      toast.error('Invalid discount', { description: 'Discount amount cannot exceed subtotal.' })
      return
    }

    const orderData: Record<string, unknown> = {
      orderType,
      items: cart.map((c) => ({
        menuItemId: c.menuItem.id,
        quantity: c.quantity,
      })),
      vatPercent,
      discount: discountAmount,
      notes: notes.trim() || undefined,
    }

    if (orderType === 'DINE_IN') {
      orderData.tableId = tableId
    }
    if (orderType === 'ROOM_SERVICE') {
      orderData.roomId = roomId
      orderData.waiterId = waiterId
      orderData.tableId = tableId
    }
    if (orderType === 'TAKEAWAY') {
      orderData.customerName = customerName.trim()
      orderData.customerPhone = customerPhone.trim() || undefined
    }

    placeOrderMutation.mutate(orderData)
  }

  // Available tables for dine-in
  const availableTables = tables.filter((t) => t.status === 'available')

  const selectedRoom = occupiedRooms.find((r) => r.room_id === roomId)
  const selectedWaiter = waiters.find((w) => w.id === waiterId)
  const selectedTable =
    (orderType === 'DINE_IN' ? availableTables : tables).find((t) => t.id === tableId) ??
    tables.find((t) => t.id === tableId)

  const filterOccupiedRoom = useCallback((room: OccupiedRoom, query: string) => {
    const q = query.toLowerCase()
    return (
      room.room_number.toLowerCase().includes(q) ||
      room.room_type.toLowerCase().includes(q)
    )
  }, [])

  const filterWaiter = useCallback((waiter: RestaurantWaiter, query: string) => {
    const q = query.toLowerCase()
    return (
      waiter.name.toLowerCase().includes(q) ||
      (waiter.phone?.toLowerCase().includes(q) ?? false)
    )
  }, [])

  const filterTable = useCallback((table: RestaurantTable, query: string) => {
    const q = query.toLowerCase()
    return (
      table.tableNumber.toLowerCase().includes(q) ||
      (table.location?.toLowerCase().includes(q) ?? false) ||
      String(table.capacity).includes(q)
    )
  }, [])

  const filterMenuItem = useCallback((item: MenuItem, query: string) => {
    const q = query.toLowerCase()
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q) ?? false) ||
      item.category.name.toLowerCase().includes(q)
    )
  }, [])

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] bg-muted overflow-hidden">
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">CloudView</h1>
              <p className="text-xs text-slate-300">Restaurant POS</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-1 justify-center min-w-0 flex-wrap">
            {POS_STATUS_STEPS.map(({ key, label, icon: Icon, className }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveStatusPanel(key)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-all cursor-pointer hover:brightness-110 ${className} ${
                  activeStatusPanel === key ? 'ring-2 ring-white/50 scale-[1.02]' : ''
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{label}</span>
                <span className="font-bold tabular-nums">{todayOrderCounts[key]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-xs">
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
                  year: 'numeric',
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex md:hidden items-center gap-1.5 px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0 overflow-x-auto">
          {POS_STATUS_STEPS.map(({ key, label, icon: Icon, className }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveStatusPanel(key)}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] shrink-0 transition-all ${className} ${
                activeStatusPanel === key ? 'ring-2 ring-white/50' : ''
              }`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span>{label}</span>
              <span className="font-bold tabular-nums">{todayOrderCounts[key]}</span>
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="px-4 py-3 bg-card border-b shrink-0">
          <PosLiveSearchField
            placeholder={
              orderType === 'ROOM_SERVICE' && !roomServiceReady
                ? 'Complete room service setup to search items…'
                : 'Search menu items… (↑↓ navigate, Enter to select)'
            }
            items={availableMenuItems}
            isLoading={menuLoading}
            disabled={orderType === 'ROOM_SERVICE' && !roomServiceReady}
            getItemId={(item) => item.id}
            getItemLabel={(item) => item.name}
            getItemSublabel={(item) =>
              `${item.category.name} · ৳${item.price.toFixed(0)}`
            }
            filterItem={filterMenuItem}
            onSelect={openQuantityDialog}
            emptyMessage="No menu items available"
            noResultsMessage="No menu items match your search"
            maxResults={20}
            overlayDropdown
            inputClassName="h-10 pl-10 bg-muted border-border"
          />
        </div>

        {/* Category Tabs */}
        <div className="px-4 py-2 bg-card border-b shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <Button
              key="all"
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('all')}
              className={
                selectedCategory === 'all'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shrink-0'
                  : 'shrink-0'
              }
            >
              All
            </Button>
            {categoriesLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-24 shrink-0" />
                ))
              : categories
                  .filter((c) => c.active)
                  .map((cat) => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={
                        selectedCategory === cat.id
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shrink-0'
                          : 'shrink-0'
                      }
                    >
                      {cat.name}
                      <span className="ml-1.5 text-xs opacity-60">({cat.itemCount})</span>
                    </Button>
                  ))}
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] hover:[scrollbar-width:thin] [&::-webkit-scrollbar]:w-0 hover:[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:rounded-full">
          {menuLoading ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <UtensilsCrossed className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No menu items found</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.menuItem.id === item.id)
                return (
                  <button
                    key={item.id}
                    onClick={() => openQuantityDialog(item)}
                    disabled={orderType === 'ROOM_SERVICE' && !roomServiceReady}
                    className={`text-left bg-card rounded-lg border-2 p-2 transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:shadow-none ${
                      inCart
                        ? 'border-amber-400 shadow-sm bg-amber-50/50'
                        : 'border-border hover:border-amber-200'
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
                            title={item.isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                          />
                          <h3 className="font-semibold text-xs text-foreground truncate">
                            {item.name}
                          </h3>
                        </div>
                      </div>
                      {inCart && (
                        <Badge className="bg-amber-500 text-white text-[9px] shrink-0 h-4 min-w-4 flex items-center justify-center px-1">
                          {inCart.quantity}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-amber-700 font-bold text-xs">
                        ৳{item.price.toFixed(0)}
                      </span>
                      {item.preparationTime && (
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="w-2 h-2" />
                          {item.preparationTime}m
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Order */}
      <div className="w-[380px] bg-card border-l flex flex-col shrink-0 shadow-xl h-full max-h-full overflow-hidden">
        {/* Order Header */}
        <div className="px-4 py-3 bg-slate-900 text-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base">Current Order</h2>
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

          {/* Order Type Toggle */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { type: 'DINE_IN' as OrderType, icon: UtensilsCrossed, label: 'Dine-in' },
              { type: 'TAKEAWAY' as OrderType, icon: ShoppingBag, label: 'Takeaway' },
              { type: 'ROOM_SERVICE' as OrderType, icon: BedDouble, label: 'Room Svc' },
            ].map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => {
                  setOrderType(type)
                  setTableId('')
                  setRoomId('')
                  setWaiterId('')
                  setRoomServiceStep(1)
                  setRoomServiceSetupComplete(false)
                  setRoomServiceSummaryExpanded(false)
                  setCustomerName('')
                  setCustomerPhone('')
                }}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                  orderType === type
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Order Details Section */}
        <div className="px-4 py-3 border-b bg-muted shrink-0">
          {orderType === 'DINE_IN' && (
            <PosLiveSearchField
              label="Select Table"
              placeholder="Search table number or location…"
              selectedId={tableId}
              selectedLabel={
                selectedTable
                  ? `Table ${selectedTable.tableNumber}${selectedTable.location ? ` · ${selectedTable.location}` : ''}`
                  : undefined
              }
              items={availableTables}
              isLoading={tablesLoading}
              getItemId={(t) => t.id}
              getItemLabel={(t) => `Table ${t.tableNumber}`}
              getItemSublabel={(t) =>
                `${t.capacity} seats${t.location ? ` · ${t.location}` : ''}`
              }
              filterItem={filterTable}
              onSelect={(t) => setTableId(t.id)}
              onClear={() => setTableId('')}
              emptyMessage="No available tables"
              noResultsMessage="No tables match your search"
            />
          )}

          {orderType === 'ROOM_SERVICE' && roomServiceSetupComplete && roomServiceReady ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setRoomServiceSummaryExpanded((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-100/50 transition-colors"
              >
                <BedDouble className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-900">Room service</p>
                  {!roomServiceSummaryExpanded && (
                    <p className="truncate text-[11px] text-emerald-800">
                      {selectedRoom ? `Room ${selectedRoom.room_number}` : '—'}
                      {' · '}
                      {selectedWaiter?.name ?? '—'}
                      {' · '}
                      {selectedTable ? `Table ${selectedTable.tableNumber}` : '—'}
                    </p>
                  )}
                </div>
                {roomServiceSummaryExpanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-emerald-700" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-emerald-700" />
                )}
              </button>
              {roomServiceSummaryExpanded && (
                <div className="space-y-2 border-t border-emerald-200 px-3 pb-3 pt-2">
                  <div className="space-y-1 text-xs text-emerald-950">
                    <p>
                      <span className="text-emerald-800">Room:</span>{' '}
                      {selectedRoom ? `Room ${selectedRoom.room_number}` : '—'}
                    </p>
                    <p>
                      <span className="text-emerald-800">Waiter:</span>{' '}
                      {selectedWaiter?.name ?? '—'}
                    </p>
                    <p>
                      <span className="text-emerald-800">Table:</span>{' '}
                      {selectedTable ? `Table ${selectedTable.tableNumber}` : '—'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full text-xs"
                    onClick={resetRoomServiceSetup}
                  >
                    Change setup
                  </Button>
                </div>
              )}
            </div>
          ) : orderType === 'ROOM_SERVICE' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">Room service</p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className={`h-1.5 w-6 rounded-full ${
                        step === roomServiceStep
                          ? 'bg-amber-500'
                          : step < roomServiceStep
                            ? 'bg-amber-300'
                            : 'bg-muted-foreground/25'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {roomServiceStep === 1 && (
                <div className="space-y-2">
                  {businessDate && (
                    <p className="text-[11px] text-muted-foreground">
                      Showing rooms checked in on business day{' '}
                      <span className="font-medium text-foreground">{businessDate}</span>
                    </p>
                  )}
                  <PosLiveSearchField
                  label="Step 1 — Room number"
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
                  onSelect={(r) => {
                    setRoomId(r.room_id)
                    setWaiterId('')
                    setTableId('')
                    setRoomServiceSetupComplete(false)
                  }}
                  onClear={() => {
                    setRoomId('')
                    setWaiterId('')
                    setTableId('')
                    setRoomServiceSetupComplete(false)
                  }}
                  emptyMessage={
                    businessDate
                      ? `No check-ins on business day ${businessDate}`
                      : 'No rooms checked in on this business day'
                  }
                  noResultsMessage="No rooms match your search"
                />
                </div>
              )}

              {roomServiceStep === 2 && (
                <PosLiveSearchField
                  label="Step 2 — Waiter"
                  placeholder="Search waiter name…"
                  selectedId={waiterId}
                  selectedLabel={selectedWaiter?.name}
                  items={waiters}
                  isLoading={waitersLoading}
                  getItemId={(w) => w.id}
                  getItemLabel={(w) => w.name}
                  getItemSublabel={(w) => w.phone || 'Restaurant staff'}
                  filterItem={filterWaiter}
                  onSelect={(w) => {
                    setWaiterId(w.id)
                    setTableId('')
                    setRoomServiceSetupComplete(false)
                  }}
                  onClear={() => {
                    setWaiterId('')
                    setTableId('')
                    setRoomServiceSetupComplete(false)
                  }}
                  emptyMessage="No waiters available"
                  noResultsMessage="No waiters match your search"
                />
              )}

              {roomServiceStep === 3 && (
                <PosLiveSearchField
                  label="Step 3 — Table"
                  placeholder="Search table number…"
                  selectedId={tableId}
                  selectedLabel={
                    selectedTable
                      ? `Table ${selectedTable.tableNumber}${selectedTable.location ? ` · ${selectedTable.location}` : ''}`
                      : undefined
                  }
                  items={tables}
                  isLoading={tablesLoading}
                  getItemId={(t) => t.id}
                  getItemLabel={(t) => `Table ${t.tableNumber}`}
                  getItemSublabel={(t) =>
                    `${t.capacity} seats${t.location ? ` · ${t.location}` : ''} · ${t.status}`
                  }
                  filterItem={filterTable}
                  onSelect={(t) => {
                    setTableId(t.id)
                    setRoomServiceSetupComplete(false)
                  }}
                  onClear={() => {
                    setTableId('')
                    setRoomServiceSetupComplete(false)
                  }}
                  emptyMessage="No tables found"
                  noResultsMessage="No tables match your search"
                />
              )}

              <div className="flex gap-2 pt-1">
                {roomServiceStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9"
                    onClick={handleRoomServiceBack}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="flex-1 h-9 bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleRoomServiceNext}
                >
                  {roomServiceStep === 3 ? 'Finish' : 'Next'}
                  {roomServiceStep < 3 && <ChevronRight className="h-4 w-4 ml-1" />}
                </Button>
              </div>
            </div>
          ) : null}

          {orderType === 'TAKEAWAY' && (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Customer Name *
                </label>
                <Input
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Phone Number
                </label>
                <Input
                  placeholder="Enter phone number"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          )}
        </div>

        {/* Cart Items */}
        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          <div className="p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ShoppingBag className="w-10 h-10 mb-2" />
                <p className="text-sm">No items in cart</p>
                <p className="text-xs mt-1">Tap menu items or search to add</p>
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
                      <p className="text-xs text-amber-700 font-semibold">
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

        {/* Order Summary & Actions */}
        <div className="border-t bg-card shrink-0 sticky bottom-0 z-10">
          {/* Notes */}
          {cart.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex justify-end items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Notes</span>
                <Switch
                  checked={showNotes}
                  onCheckedChange={setShowNotes}
                  className="data-[state=checked]:bg-black data-[state=unchecked]:bg-slate-300"
                />
              </div>
            </div>
          )}
          {cart.length > 0 && showNotes && (
            <div className="px-4 pt-3">
              <Textarea
                placeholder="Special instructions..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-16 text-xs resize-none"
              />
            </div>
          )}

          {/* Totals */}
          <div className="px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">৳{subtotal.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-muted-foreground">Discount</span>
              <div className="flex items-center gap-1.5">
                <Select
                  value={discountType}
                  onValueChange={(v) => setDiscountType(v as DiscountType)}
                >
                  <SelectTrigger className="h-7 w-[98px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="AMOUNT">Amount</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={discountType === 'PERCENTAGE' ? 100 : subtotal}
                  value={discount || ''}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-20 text-right text-xs"
                  placeholder={discountType === 'PERCENTAGE' ? '%' : '৳'}
                />
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Discount Applied</span>
              <span>৳{discountAmount.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
              <span className="font-medium">৳{vatAmount.toFixed(0)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="text-amber-700">৳{totalAmount.toFixed(0)}</span>
            </div>
          </div>

          {/* Place Order Button */}
          <div className="px-4 pb-4">
            <Button
              onClick={handlePlaceOrder}
              disabled={cart.length === 0 || placeOrderMutation.isPending}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white font-bold text-base gap-2 disabled:opacity-50"
            >
              {placeOrderMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Placing Order...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Place Order ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={!!activeStatusPanel}
        onOpenChange={(open) => !open && setActiveStatusPanel(null)}
      >
        <DialogContent className="flex h-[min(88vh,920px)] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>{activeStatusPanelMeta?.panelTitle ?? "Today's Orders"}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {activeStatusPanel === 'DELIVERED'
                ? `${todayOrderCounts.DELIVERED} order${todayOrderCounts.DELIVERED === 1 ? '' : 's'} — payment, due, and billing actions`
                : activeStatusPanel
                  ? `${todayOrderCounts[activeStatusPanel]} order${todayOrderCounts[activeStatusPanel] === 1 ? '' : 's'} — tap an action to move to the next stage`
                  : ''}
            </p>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-4">
            {statusOrdersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-lg" />
                ))}
              </div>
            ) : statusPanelOrders.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <ChefHat className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No orders in this stage for today.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {statusPanelOrders.map((order) => {
                  const typeCfg = POS_ORDER_TYPE_ICON[order.orderType]
                  const TypeIcon = typeCfg.icon
                  const nextStep = activeStatusPanel ? POS_STATUS_NEXT[activeStatusPanel] : null

                  return (
                    <div key={order.id} className="rounded-lg border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold font-mono text-sm">{order.orderNumber}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(order.createdAt).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          <Badge variant="outline" className="text-[10px] h-5 gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {typeCfg.label}
                          </Badge>
                          {order.orderType === 'DINE_IN' && order.table && (
                            <Badge variant="outline" className="text-[10px] h-5">
                              Table {order.table.tableNumber}
                            </Badge>
                          )}
                          {order.orderType === 'ROOM_SERVICE' && order.room && (
                            <Badge variant="outline" className="text-[10px] h-5">
                              Room {order.room.roomNumber}
                            </Badge>
                          )}
                          {order.orderType === 'TAKEAWAY' && order.customerName && (
                            <Badge variant="outline" className="text-[10px] h-5">
                              {order.customerName}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                                }`}
                              />
                              <span className="truncate">{item.menuItem.name}</span>
                            </div>
                            <Badge variant="secondary" className="text-xs h-5 shrink-0">
                              ×{item.quantity}
                            </Badge>
                          </div>
                        ))}
                      </div>

                      {order.notes && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded">
                          {order.notes}
                        </p>
                      )}

                      {activeStatusPanel === 'DELIVERED' && (
                        <RestaurantOrderPaymentSummary
                          totalAmount={order.totalAmount}
                          payments={order.payments}
                          billingDisposition={order.billingDisposition}
                          companyLedgerBill={order.companyLedgerBill}
                        />
                      )}

                      <div className="flex items-center justify-between gap-2 pt-1">
                        {activeStatusPanel !== 'DELIVERED' && (
                          <span className="text-sm font-semibold shrink-0">
                            ৳{order.totalAmount.toFixed(0)}
                          </span>
                        )}
                        <div
                          className={cn(
                            'flex flex-row flex-nowrap items-center gap-1 min-w-0',
                            activeStatusPanel === 'DELIVERED' ? 'w-full justify-end' : 'justify-end'
                          )}
                        >
                          {nextStep?.next ? (
                            <Button
                              size="sm"
                              className={`h-8 shrink-0 text-xs text-white ${nextStep.buttonClass}`}
                              disabled={statusUpdateMutation.isPending}
                              onClick={() =>
                                statusUpdateMutation.mutate({
                                  id: order.id,
                                  status: nextStep.next!,
                                })
                              }
                            >
                              {nextStep.next === 'COOKING' && <Flame className="h-3.5 w-3.5 mr-1" />}
                              {nextStep.next === 'READY' && (
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              )}
                              {nextStep.next === 'DELIVERED' && (
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              )}
                              {nextStep.label}
                            </Button>
                          ) : null}
                          {activeStatusPanel === 'DELIVERED' && (
                            <RestaurantOrderDeliveredActions
                              order={order}
                              iconOnly
                              onPay={(selected) => {
                                setPayTarget({
                                  order: {
                                    id: selected.id,
                                    orderNumber: selected.orderNumber,
                                    totalAmount: selected.totalAmount,
                                    payments: selected.payments,
                                  },
                                  roomGuest: isRoomServiceGuestOrder(selected),
                                })
                                setPayDialogOpen(true)
                              }}
                              onSendToHotel={(orderId) => sendToHotelMutation.mutate(orderId)}
                              sendToHotelPending={sendToHotelMutation.isPending}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/20">
            <Button type="button" variant="outline" onClick={() => setActiveStatusPanel(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quantity dialog — opened when selecting from menu search */}
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
                <span className="font-semibold text-amber-700">
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

          <DialogFooter className="gap-4">
            <Button type="button" variant="outline" onClick={closeQuantityDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={confirmQuantityDialog}
              disabled={!quantityDialogItem || quantityDialogQty < 1}
            >
              Add to cart
            </Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <RestaurantOrderPaymentDialog
        order={payTarget?.order ?? null}
        open={payDialogOpen}
        onOpenChange={(open) => {
          setPayDialogOpen(open)
          if (!open) setPayTarget(null)
        }}
        roomGuestOrder={payTarget?.roomGuest ?? false}
      />
    </div>
  )
}
