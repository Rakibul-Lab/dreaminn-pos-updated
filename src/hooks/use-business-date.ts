'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { DayCloseSnapshot } from '@/lib/day-close-snapshot'

type BusinessDateResponse = {
  success: boolean
  data?: {
    businessDate: string
    calendarDate: string
    openedAt: string
    preview: DayCloseSnapshot
    dayCloseRequired?: boolean
    daysBehind?: number
    dayCloseMessage?: string | null
  }
}

export function useBusinessDate() {
  return useQuery({
    queryKey: ['business-date'],
    queryFn: () => api.get<BusinessDateResponse>('/business-date'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

export function useDayCloseGate() {
  const query = useBusinessDate()
  const data = query.data?.data
  return {
    ...query,
    warning: Boolean(data?.dayCloseRequired),
    blocked: false,
    message: data?.dayCloseMessage ?? null,
    businessDate: data?.businessDate,
    calendarDate: data?.calendarDate,
    daysBehind: data?.daysBehind ?? 0,
  }
}
