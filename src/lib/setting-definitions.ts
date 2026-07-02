export type SettingGroup = 'hotel' | 'restaurant' | 'general' | 'billing' | 'payment'

export type SettingDefinition = {
  key: string
  value: string
  group: SettingGroup
  label: string
  inputType?: 'text' | 'number' | 'time'
  hint?: string
}

/** Canonical defaults — merged with DB on read so hotel/restaurant sections always appear. */
export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'current_business_date',
    value: '',
    group: 'hotel',
    label: 'Current Business Date',
    inputType: 'text',
    hint: 'Hotel operating date (yyyy-MM-dd). Advanced automatically on day close.',
  },
  {
    key: 'hotel_name',
    value: 'RRP Dream Inn',
    group: 'hotel',
    label: 'Hotel Name',
    inputType: 'text',
  },
  {
    key: 'check_in_time',
    value: '14:00',
    group: 'hotel',
    label: 'Standard Check-in Time',
    inputType: 'time',
    hint: 'Applied to all reservation check-in dates (e.g. 2:00 PM)',
  },
  {
    key: 'check_out_time',
    value: '12:00',
    group: 'hotel',
    label: 'Standard Check-out Time',
    inputType: 'time',
    hint: 'Applied to all reservation check-out dates and late-checkout deadline',
  },
  {
    key: 'auto_next_day_bill_time',
    value: '14:00',
    group: 'hotel',
    label: 'Auto Next-Day Bill Time',
    inputType: 'time',
    hint: 'After this time on the check-out day, an extra night is auto-added if the guest has not checked out (standard 2:00 PM)',
  },
  {
    key: 'late_checkout_charge',
    value: '500',
    group: 'hotel',
    label: 'Late Checkout Charge (৳)',
    inputType: 'number',
    hint: 'Flat fee when guest checks out after scheduled check-out time',
  },
  {
    key: 'early_checkout_fee_percent',
    value: '50',
    group: 'hotel',
    label: 'Early Checkout Fee (%)',
    inputType: 'number',
    hint: 'Default % of waived room nights when guest leaves before reservation end',
  },
  {
    key: 'early_checkout_fee_amount',
    value: '500',
    group: 'hotel',
    label: 'Early Checkout Fee (৳ flat)',
    inputType: 'number',
    hint: 'Default flat fee when early checkout uses fixed amount mode',
  },
  {
    key: 'vat_percent',
    value: '15',
    group: 'hotel',
    label: 'Room VAT (%)',
    inputType: 'number',
    hint: 'Default VAT on room charges, reservations, and hotel invoices',
  },
  {
    key: 'hotel_service_charge_percent',
    value: '10',
    group: 'hotel',
    label: 'Room Service Charge (%)',
    inputType: 'number',
    hint: 'Default service charge % shown on reservations and hotel invoices',
  },
  {
    key: 'restaurant_name',
    value: 'CloudView',
    group: 'restaurant',
    label: 'Restaurant Name',
    inputType: 'text',
  },
  {
    key: 'restaurant_vat_percent',
    value: '15',
    group: 'restaurant',
    label: 'Restaurant VAT (%)',
    inputType: 'number',
    hint: 'VAT applied on restaurant POS orders and food bills',
  },
  {
    key: 'currency',
    value: 'BDT',
    group: 'general',
    label: 'Currency',
    inputType: 'text',
  },
]

const DEF_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]))

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return DEF_BY_KEY.get(key)
}

export function guessGroupFromKey(key: string): string {
  if (
    key.startsWith('hotel_') ||
    key.startsWith('room_') ||
    key === 'vat_percent' ||
    key.startsWith('late_checkout') ||
    key.startsWith('early_checkout') ||
    key === 'check_in_time' ||
    key === 'check_out_time' ||
    key === 'current_business_date'
  ) {
    return 'hotel'
  }
  if (key.startsWith('restaurant_') || key.startsWith('menu_')) return 'restaurant'
  if (key.startsWith('vat_') || key.startsWith('tax_') || key.startsWith('invoice_')) return 'billing'
  if (key.startsWith('payment_')) return 'payment'
  return 'general'
}
