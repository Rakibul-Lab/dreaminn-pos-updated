import { buildCheckInOutPolicyText, DEFAULT_HOTEL_TIMES, type HotelTimes } from '@/lib/hotel-times'

export const HOTEL_NAME = 'RRP Dream Inn'
export const HOTEL_TAGLINE = 'Comfort & hospitality, every stay'
export const HOTEL_LOCATION = 'RRP Center, Post office More, Ishwardi, Pabna, Bangladesh'

export const RESERVATION_INTRO =
  `Thank you for your interest in '${HOTEL_NAME}'. We are pleased to confirm the following reservation details for your kind reference.`

/** Compact policies to fit one A4 page (print / PDF). */
export const RESERVATION_POLICIES: { title: string; text: string }[] = [
  {
    title: 'Complimentary',
    text: 'Wi-Fi in guest rooms and common areas (where available).',
  },
  {
    title: 'Check-in & Check-out',
    text: buildCheckInOutPolicyText(DEFAULT_HOTEL_TIMES),
  },
  {
    title: 'Guarantee & Cancellation',
    text: 'Reservations may be released if not guaranteed. Cancel or amend at least 24 hours before check-in to avoid one-night charge.',
  },
  {
    title: 'Payment',
    text: 'Rates in BDT. Restaurant, laundry, minibar and incidentals billed to guest folio.',
  },
  {
    title: 'General',
    text: 'Valid NID/Passport/Driving License required at check-in. Non-smoking rooms. Hotel may refuse service for policy violations.',
  },
  {
    title: 'Limitation of Liability',
    text: 'The hotel shall not be responsible for any loss, theft, damage to personal belongings, personal injury, accidents, illness, or any other harm suffered by guests or visitors during their stay, except where required by applicable law. Guests are responsible for safeguarding their personal property and valuables.',
  },
]

export const RESERVATION_TERMS_AND_CONDITIONS = RESERVATION_POLICIES.map(
  (p, i) => `${i + 1}. ${p.title}: ${p.text}`
)

export const HOTEL_RESERVATION_FOOTER =
  `${HOTEL_NAME} — Thank you for choosing us. For inquiries please contact the front desk.`

export const INVOICE_GUEST_AGREEMENT =
  'I agree that all charges listed on this invoice are correct and I accept the hotel terms and conditions stated above.'

/** @deprecated Use formatReservationMealPlan(withMeal) for booking documents. */
export const DEFAULT_MEAL_PLAN = 'Breakfast (complementary)'

export const MEAL_PLAN_WITH_MEAL = 'Full Board (Breakfast complimentary)'
export const MEAL_PLAN_WITHOUT_MEAL = 'Breakfast (complementary)'

export function formatReservationMealPlan(withMeal?: boolean | null): string {
  return withMeal === true ? MEAL_PLAN_WITH_MEAL : MEAL_PLAN_WITHOUT_MEAL
}

export const DEFAULT_SMOKING_STATUS = 'Non Smoking'

/** Default company / source on new reservations (editable by staff). */
export const DEFAULT_GUEST_COMPANY = 'Direct/Walk in'

export function reservationPoliciesWithTimes(times: HotelTimes = DEFAULT_HOTEL_TIMES) {
  return RESERVATION_POLICIES.map((policy) =>
    policy.title === 'Check-in & Check-out'
      ? { ...policy, text: buildCheckInOutPolicyText(times) }
      : policy
  )
}

export function formatGuestCompany(company?: string | null): string {
  const trimmed = company?.trim()
  return trimmed || DEFAULT_GUEST_COMPANY
}

/** Document heading based on booking status at print time. */
export function reservationDocumentTitle(status: string): string {
  if (status === 'CHECKED_IN') return 'Checked In Confirmation'
  if (status === 'CHECKED_OUT') return 'Checked Out Confirmation'
  return 'Reservation Confirmation'
}

/** Document heading for reservation entry (inventory hold). */
export function reservationEntryDocumentTitle(entryStatus: string): string {
  if (entryStatus === 'CANCELLED') return 'Reservation Entry — Cancelled'
  if (entryStatus === 'FULFILLED') return 'Reservation Entry — Fulfilled'
  if (entryStatus === 'PARTIALLY_FULFILLED') return 'Reservation Entry — Partially Fulfilled'
  return 'Reservation Entry Confirmation'
}
