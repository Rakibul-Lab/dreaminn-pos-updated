export type NewReservationTabOptions = {
  roomId?: string
  checkIn?: string
  checkOut?: string
}

export function openNewReservationTab(options?: string | NewReservationTabOptions) {
  if (typeof window === 'undefined') return
  const opts: NewReservationTabOptions =
    typeof options === 'string' ? { roomId: options } : (options ?? {})
  const params = new URLSearchParams()
  if (opts.roomId) params.set('roomId', opts.roomId)
  if (opts.checkIn) params.set('checkIn', opts.checkIn)
  if (opts.checkOut) params.set('checkOut', opts.checkOut)
  const qs = params.toString()
  window.open(`/reservations/new${qs ? `?${qs}` : ''}`, '_blank', 'noopener,noreferrer')
}

export function openRegistrationFormTab() {
  if (typeof window === 'undefined') return
  window.open('/registration-form', '_blank', 'noopener,noreferrer')
}
