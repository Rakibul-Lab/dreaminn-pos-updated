import { computeHotelDiscountAmount, type BookingDiscountType } from '@/lib/booking-discount'
import {
  INVOICE_SD_PERCENT,
  INVOICE_SERVICE_CHARGE_PERCENT,
  INVOICE_VAT_PERCENT,
  INVOICE_ZERO_DISCOUNT_DISPLAY,
  buildChargeDisplayRow,
  decomposeGrossAfterDiscount,
  formatDiscountLabel,
  type InvoiceChargeDisplayRow,
} from '@/lib/invoice-display'
import {
  GUEST_FOLIO_RESTAURANT_VAT_PERCENT,
  isGuestFolioManualRestaurantBill,
} from '@/lib/booking-restaurant-bill.shared'

const HOTEL_CHARGE_TYPES = new Set(['room_charge', 'extra_service', 'discount'])
const RESTAURANT_CHARGE_TYPES = new Set(['food_order'])

type LineItem = {
  id: string
  itemType?: string
  referenceId?: string | null
  description: string
  total: number
}

type RestaurantOrder = {
  id: string
  orderNumber: string
  subtotal: number
  discount: number
  vatPercent: number
  vatAmount: number
  createdAt: string
  notes?: string | null
}

type BuildRowsContext = {
  lineItems: LineItem[]
  roomBill: number
  extraBill: number
  roomVat: number
  hotelVatPercent: number
  hotelServiceChargePercent: number
  restaurantBill: number
  restaurantVat: number
  restaurantOrders: RestaurantOrder[]
  bookedNights: number
  nightlyRate: number
  hotelDiscountAmount: number
  hotelDiscountLabel: string
  hotelDiscountEnabled?: boolean
  hotelDiscountType?: BookingDiscountType
  hotelDiscountValue?: number
  roomNumber: string
  roomTypeName: string
  stayDateTime: { date: string; time: string }
  invoiceDateTime: { date: string; time: string }
  resolveItemDateTime: (type: string, referenceId?: string | null) => { date: string; time: string }
  resolveOrderVatPercent: (description: string) => number | null
  defaultRestaurantVatPercent: number | null
}

function resolveRestaurantRowServicePercent(
  ctx: BuildRowsContext,
  referenceId?: string | null,
  description?: string
): number {
  const order = ctx.restaurantOrders?.find((o) => o.id === referenceId)
  if (order && isGuestFolioManualRestaurantBill(order)) return 0
  if (description?.includes('Bill No.')) return 0
  return INVOICE_SERVICE_CHARGE_PERCENT
}

function resolveRestaurantRowVatPercent(
  ctx: BuildRowsContext,
  description: string,
  referenceId?: string | null
): number {
  const order = ctx.restaurantOrders?.find((o) => o.id === referenceId)
  if (order && isGuestFolioManualRestaurantBill(order)) {
    return order.vatPercent && order.vatPercent > 0
      ? order.vatPercent
      : GUEST_FOLIO_RESTAURANT_VAT_PERCENT
  }
  return ctx.resolveOrderVatPercent(description) ?? INVOICE_VAT_PERCENT
}

function lineItemCategory(type: string) {
  switch (type) {
    case 'room_charge':
      return 'Room Rent'
    case 'extra_service':
      return 'Service'
    case 'food_order':
      return 'F&B'
    case 'discount':
      return 'Discount'
    default:
      return type.replace(/_/g, ' ')
  }
}

/**
 * Room rent shown on the invoice is the actual room charge on the folio
 * (`roomBill`) — this already reflects any amount edited at checkout or a stay
 * adjustment. Falls back to nightly rate × nights only when no charge is stored.
 */
function resolveHotelGrossRoomRent(ctx: BuildRowsContext): number {
  if (ctx.roomBill > 0) {
    return Math.round(ctx.roomBill)
  }
  if (ctx.nightlyRate > 0 && ctx.bookedNights > 0) {
    return Math.round(ctx.nightlyRate * ctx.bookedNights)
  }
  return ctx.roomBill
}

/** Show full gross in Room Rent; discount reduces total before SD/VAT/service are derived. */
function buildInclusiveGrossChargeRow(
  row: Omit<
    InvoiceChargeDisplayRow,
    'roomRent' | 'sdAmount' | 'vatAmount' | 'serviceChargeAmount' | 'amount'
  > & {
    grossRent: number
    vatPercent: number
    servicePercent?: number
    sdPercent?: number
  }
): InvoiceChargeDisplayRow {
  const {
    grossRent,
    vatPercent,
    servicePercent = INVOICE_SERVICE_CHARGE_PERCENT,
    sdPercent = INVOICE_SD_PERCENT,
    ...rest
  } = row
  const discountAmount = rest.discountAmount ?? 0
  const { sdAmount, vatAmount, serviceChargeAmount, discountedGross } = decomposeGrossAfterDiscount(
    grossRent,
    discountAmount,
    vatPercent,
    servicePercent,
    sdPercent
  )
  return buildChargeDisplayRow({
    ...rest,
    roomRent: grossRent,
    sdAmount,
    vatAmount,
    serviceChargeAmount,
    discountAmount,
    amount: discountedGross,
  })
}

function sumHotelDiscountFromLineItems(ctx: BuildRowsContext): number {
  return ctx.lineItems
    .filter((item) => item.itemType === 'discount')
    .reduce((sum, item) => sum + Math.abs(item.total), 0)
}

function resolveHotelRowDiscount(
  ctx: BuildRowsContext,
  grossRent: number
): { amount: number; label: string } {
  const fromLineItems = sumHotelDiscountFromLineItems(ctx)
  if (fromLineItems > 0) {
    const type = ctx.hotelDiscountType ?? 'PERCENTAGE'
    const value = ctx.hotelDiscountValue ?? 0
    return {
      amount: fromLineItems,
      label:
        ctx.hotelDiscountEnabled && value > 0
          ? formatDiscountLabel(type, value, fromLineItems)
          : ctx.hotelDiscountLabel && ctx.hotelDiscountLabel !== INVOICE_ZERO_DISCOUNT_DISPLAY
            ? ctx.hotelDiscountLabel
            : formatDiscountLabel('FIXED', fromLineItems, fromLineItems),
    }
  }

  if (ctx.hotelDiscountEnabled && (ctx.hotelDiscountValue ?? 0) > 0 && grossRent > 0) {
    const type = ctx.hotelDiscountType ?? 'PERCENTAGE'
    const value = ctx.hotelDiscountValue ?? 0
    const amount = Math.round(computeHotelDiscountAmount(grossRent, true, type, value))
    return {
      amount,
      label: formatDiscountLabel(type, value, amount),
    }
  }

  const amount = Math.max(0, ctx.hotelDiscountAmount)
  return {
    amount,
    label: amount > 0 ? ctx.hotelDiscountLabel : INVOICE_ZERO_DISCOUNT_DISPLAY,
  }
}

function buildHotelRoomRentRow(
  ctx: BuildRowsContext,
  id = 'hotel-room-rent'
): InvoiceChargeDisplayRow {
  const { date, time } = ctx.stayDateTime
  const grossRent = resolveHotelGrossRoomRent(ctx)
  const vatPercent = ctx.hotelVatPercent || INVOICE_VAT_PERCENT
  const servicePercent = ctx.hotelServiceChargePercent ?? INVOICE_SERVICE_CHARGE_PERCENT
  const { amount: discountAmount, label: discountLabel } = resolveHotelRowDiscount(ctx, grossRent)

  return buildInclusiveGrossChargeRow({
    id,
    date,
    time,
    category: ctx.roomTypeName || 'Room',
    description: '',
    grossRent,
    vatPercent,
    servicePercent,
    discountLabel,
    discountAmount,
  })
}

function buildHotelRowsFromLineItems(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  const roomItems = ctx.lineItems.filter((item) => item.itemType === 'room_charge')
  const extraItems = ctx.lineItems.filter((item) => item.itemType === 'extra_service')

  const rows: InvoiceChargeDisplayRow[] = []

  if (roomItems.length > 0 || resolveHotelGrossRoomRent(ctx) > 0) {
    rows.push(buildHotelRoomRentRow(ctx, roomItems[0]?.id ?? 'hotel-room-rent'))
  }

  for (const item of extraItems) {
    const { date, time } = ctx.resolveItemDateTime('extra_service', item.referenceId)
    const base = Math.abs(item.total)
    const isBeverage = item.description.toLowerCase().includes('beverage')
    const isLateCheckout = item.description.toLowerCase().includes('late checkout')
    rows.push(
      buildChargeDisplayRow({
        id: item.id,
        date,
        time,
        category: isBeverage
          ? 'Hotel Beverage'
          : isLateCheckout
            ? item.description
            : lineItemCategory('extra_service'),
        description: isLateCheckout ? '' : item.description,
        roomRent: base,
        sdAmount: 0,
        vatAmount: 0,
        serviceChargeAmount: 0,
        discountLabel: INVOICE_ZERO_DISCOUNT_DISPLAY,
        discountAmount: 0,
      })
    )
  }

  return rows
}

function buildFallbackHotelRows(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  const rows: InvoiceChargeDisplayRow[] = []
  const grossRent = resolveHotelGrossRoomRent(ctx)

  if (grossRent > 0) {
    rows.push(buildHotelRoomRentRow(ctx, 'fb-room'))
  } else if (ctx.extraBill > 0) {
    rows.push(
      buildChargeDisplayRow({
        id: 'fb-extra',
        date: ctx.stayDateTime.date,
        time: ctx.stayDateTime.time,
        category: 'Service',
        description: 'Extra / service charges',
        roomRent: ctx.extraBill,
        sdAmount: 0,
        vatAmount: 0,
        serviceChargeAmount: 0,
        discountLabel: INVOICE_ZERO_DISCOUNT_DISPLAY,
        discountAmount: 0,
      })
    )
  }
  return rows
}

export function buildHotelInvoiceChargeRows(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  const fromItems = buildHotelRowsFromLineItems(ctx)
  if (fromItems.length > 0) return fromItems
  return buildFallbackHotelRows(ctx)
}

function buildRestaurantRowsFromLineItems(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  return ctx.lineItems
    .filter((item) => RESTAURANT_CHARGE_TYPES.has(item.itemType || ''))
    .map((item) => {
      const { date, time } = ctx.resolveItemDateTime('food_order', item.referenceId)
      const gross = item.total
      if (gross <= 0 || item.description.toLowerCase().includes('discount')) {
        const discountAmount = Math.abs(gross)
        return buildChargeDisplayRow({
          id: item.id,
          date,
          time,
          category: 'Discount',
          description: item.description,
          roomRent: 0,
          sdAmount: 0,
          vatAmount: 0,
          serviceChargeAmount: 0,
          discountLabel: 'Discount',
          discountAmount,
          amount: gross,
        })
      }

      const vatPercent = resolveRestaurantRowVatPercent(ctx, item.description, item.referenceId)
      const servicePercent = resolveRestaurantRowServicePercent(
        ctx,
        item.referenceId,
        item.description
      )

      return buildInclusiveGrossChargeRow({
        id: item.id,
        date,
        time,
        category: 'F&B',
        description: item.description,
        grossRent: gross,
        vatPercent,
        servicePercent,
        discountLabel: INVOICE_ZERO_DISCOUNT_DISPLAY,
        discountAmount: 0,
      })
    })
}

function buildFallbackRestaurantRows(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  if (ctx.restaurantBill <= 0) return []
  const order = ctx.restaurantOrders[0]
  const dt = order
    ? { date: ctx.resolveItemDateTime('food_order', order.id).date, time: ctx.resolveItemDateTime('food_order', order.id).time }
    : ctx.invoiceDateTime
  const vatPercent = ctx.defaultRestaurantVatPercent ?? INVOICE_VAT_PERCENT
  const servicePercent =
    order && isGuestFolioManualRestaurantBill(order)
      ? 0
      : INVOICE_SERVICE_CHARGE_PERCENT
  const resolvedVat =
    order && isGuestFolioManualRestaurantBill(order)
      ? order.vatPercent > 0
        ? order.vatPercent
        : GUEST_FOLIO_RESTAURANT_VAT_PERCENT
      : vatPercent

  return [
    buildInclusiveGrossChargeRow({
      id: 'fb-food',
      date: dt.date,
      time: dt.time,
      category: 'F&B',
      description: 'Restaurant charges',
      grossRent: ctx.restaurantBill,
      vatPercent: resolvedVat,
      servicePercent,
      discountLabel: INVOICE_ZERO_DISCOUNT_DISPLAY,
      discountAmount: 0,
    }),
  ]
}

export function buildRestaurantInvoiceChargeRows(ctx: BuildRowsContext): InvoiceChargeDisplayRow[] {
  const fromItems = buildRestaurantRowsFromLineItems(ctx)
  if (fromItems.length > 0) return fromItems
  return buildFallbackRestaurantRows(ctx)
}

/** Service % label for restaurant invoice table — guest folio manual bills have no service charge. */
export function resolveRestaurantInvoiceServicePercentLabel(
  restaurantOrders: Array<{ notes?: string | null; items?: unknown[] | null }>
): number {
  if (restaurantOrders.length === 0) return INVOICE_SERVICE_CHARGE_PERCENT
  const allGuestFolioManual = restaurantOrders.every((order) =>
    isGuestFolioManualRestaurantBill(order)
  )
  return allGuestFolioManual ? 0 : INVOICE_SERVICE_CHARGE_PERCENT
}

/** VAT % label for restaurant invoice table header when all lines are guest folio manual bills. */
export function resolveRestaurantInvoiceVatPercentLabel(
  restaurantOrders: Array<{ vatPercent?: number; notes?: string | null; items?: unknown[] | null }>
): number {
  if (restaurantOrders.length === 0) return INVOICE_VAT_PERCENT
  const allGuestFolioManual = restaurantOrders.every((order) =>
    isGuestFolioManualRestaurantBill(order)
  )
  if (!allGuestFolioManual) {
    const rates = restaurantOrders.map((o) => o.vatPercent).filter((r) => r != null && r > 0)
    return rates.length === 1 ? rates[0]! : INVOICE_VAT_PERCENT
  }
  const rates = restaurantOrders
    .map((o) => (o.vatPercent && o.vatPercent > 0 ? o.vatPercent : GUEST_FOLIO_RESTAURANT_VAT_PERCENT))
  return rates[0] ?? GUEST_FOLIO_RESTAURANT_VAT_PERCENT
}
