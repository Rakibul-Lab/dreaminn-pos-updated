/** Client-side helpers for day-close mismatch warnings (operations are not blocked). */

export type DayCloseGateData = {
  dayCloseRequired?: boolean
  dayCloseMessage?: string | null
  businessDate?: string
  calendarDate?: string
}

export function isDayCloseWarningActive(data?: DayCloseGateData): boolean {
  return Boolean(data?.dayCloseRequired)
}

/** @deprecated Operations are no longer blocked; use isDayCloseWarningActive for banners. */
export function isDayCloseBlockingOperations(_data?: DayCloseGateData): boolean {
  return false
}

export function getDayCloseWarningMessage(data?: DayCloseGateData): string {
  if (data?.dayCloseMessage) return data.dayCloseMessage
  if (data?.businessDate && data?.calendarDate) {
    return `Business day is still ${data.businessDate} but today is ${data.calendarDate}. Run Day Close when ready; check-ins and reservations can continue.`
  }
  return 'The open business day is behind the calendar date. Run Day Close when you are ready to advance.'
}

/** @deprecated Use getDayCloseWarningMessage */
export function getDayCloseBlockMessage(data?: DayCloseGateData): string {
  return getDayCloseWarningMessage(data)
}
