'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { getSettingDefinition } from '@/lib/setting-definitions'
import { toTimeInputValue } from '@/lib/hotel-times'
import { VAT_PERCENT_INPUT_STEP } from '@/lib/booking-totals'
import {
  Settings, Save, Hotel, UtensilsCrossed, Wrench, RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

interface SettingItem {
  id: string
  key: string
  value: string
}

const DISPLAY_GROUP_ORDER = ['hotel', 'restaurant', 'general', 'billing', 'payment']

export default function SettingsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { settings: SettingItem[]; grouped: Record<string, SettingItem[]> } }>('/settings')
      return res.data
    },
    enabled: !!user && canAccessAdmin(user?.role),
  })

  const saveMutation = useMutation({
    mutationFn: async (updates: Array<{ key: string; value: string }>) => {
      return api.put('/settings', updates)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['billing-settings'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-settings'] })
      queryClient.invalidateQueries({ queryKey: ['hotel-settings'] })
      setEditedValues({})
      toast({ title: 'Settings Saved', description: 'Hotel and restaurant settings are now active across the system.' })
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to save settings'
      toast({ title: 'Error', description: message, variant: 'destructive' })
    },
  })

  if (!user || !canAccessAdmin(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only administrators can access settings.</p>
        </CardContent>
      </Card>
    )
  }

  const grouped = settingsData?.grouped || {}
  const groupIcons: Record<string, React.ReactNode> = {
    hotel: <Hotel className="h-5 w-5 text-amber-600" />,
    restaurant: <UtensilsCrossed className="h-5 w-5 text-emerald-600" />,
    general: <Wrench className="h-5 w-5 text-sky-600" />,
    billing: <Settings className="h-5 w-5 text-purple-600" />,
    payment: <Settings className="h-5 w-5 text-orange-600" />,
  }

  const groupLabels: Record<string, string> = {
    hotel: 'Hotel Settings',
    restaurant: 'Restaurant Settings',
    general: 'General Settings',
    billing: 'Billing Settings',
    payment: 'Payment Settings',
  }

  const groupDescriptions: Record<string, string> = {
    hotel: 'Check-in/out times, room VAT, late checkout fee, and hotel branding',
    restaurant: 'Restaurant name and VAT rate for POS orders',
  }

  const handleSave = () => {
    const updates: Array<{ key: string; value: string }> = []
    const seen = new Set<string>()

    for (const group of sortedGroups) {
      for (const item of grouped[group] || []) {
        if (item.key === 'late_checkout_hours') continue
        if (item.key === 'auto_next_day_bill_time') continue
        if (item.key === 'early_arrival_night_cutoff') continue
        const def = getSettingDefinition(item.key)
        const original =
          def?.inputType === 'time'
            ? toTimeInputValue(item.value, def.value)
            : item.value
        const current =
          def?.inputType === 'time'
            ? toTimeInputValue(getValue(item.key, item.value), def.value)
            : getValue(item.key, item.value)
        if (current !== original && !seen.has(item.key)) {
          seen.add(item.key)
          updates.push({ key: item.key, value: current })
        }
      }
    }

    if (updates.length === 0) {
      toast({ title: 'No Changes', description: 'There are no changes to save' })
      return
    }
    saveMutation.mutate(updates)
  }

  const getValue = (key: string, originalValue: string) => {
    if (editedValues[key] !== undefined) return editedValues[key]
    const def = getSettingDefinition(key)
    if (def?.inputType === 'time') return toTimeInputValue(originalValue, def.value)
    return originalValue
  }

  const setFieldValue = (key: string, value: string) => {
    const def = getSettingDefinition(key)
    const normalized =
      def?.inputType === 'time' ? toTimeInputValue(value, def.value) : value
    setEditedValues((prev) => ({ ...prev, [key]: normalized }))
  }

  const sortedGroups = [
    ...DISPLAY_GROUP_ORDER.filter((g) => grouped[g]?.length),
    ...Object.keys(grouped).filter((g) => !DISPLAY_GROUP_ORDER.includes(g)),
  ]

  const hasPendingChanges = sortedGroups.some((group) =>
    (grouped[group] || []).some((item) => {
      if (item.key === 'late_checkout_hours') return false
      if (item.key === 'auto_next_day_bill_time') return false
      if (item.key === 'early_arrival_night_cutoff') return false
      const def = getSettingDefinition(item.key)
      const original =
        def?.inputType === 'time' ? toTimeInputValue(item.value, def.value) : item.value
      const current =
        def?.inputType === 'time'
          ? toTimeInputValue(getValue(item.key, item.value), def.value)
          : getValue(item.key, item.value)
      return current !== original
    })
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6 text-amber-600" />
            System Settings
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Configure hotel and restaurant operations</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['settings'] })}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleSave}
            disabled={saveMutation.isPending || !hasPendingChanges}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {hasPendingChanges && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3 flex items-center justify-between">
            <p className="text-sm text-amber-700">
              <Badge variant="outline" className="bg-amber-100 text-amber-700 mr-2">
                {Object.keys(editedValues).length}
              </Badge>
              unsaved change(s)
            </p>
            <Button variant="ghost" size="sm" onClick={() => setEditedValues({})}>
              Discard
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        sortedGroups.map((group) => {
          const items = grouped[group] || []
          return (
            <Card key={group}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  {groupIcons[group] || <Settings className="h-5 w-5 text-muted-foreground" />}
                  {groupLabels[group] || `${group.charAt(0).toUpperCase() + group.slice(1)} Settings`}
                </CardTitle>
                {groupDescriptions[group] && (
                  <p className="text-sm text-muted-foreground font-normal">{groupDescriptions[group]}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {items
                  .filter(
                    (item) =>
                      item.key !== 'late_checkout_hours' &&
                      item.key !== 'auto_next_day_bill_time' &&
                      item.key !== 'early_arrival_night_cutoff'
                  )
                  .map((item, index) => {
                  const def = getSettingDefinition(item.key)
                  const label =
                    def?.label ||
                    item.key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                  const isNumber = def?.inputType === 'number'
                  const isTime = def?.inputType === 'time'
                  const isPercent = item.key.includes('percent')

                  return (
                    <div key={item.id}>
                      {index > 0 && <Separator className="mb-4" />}
                      <div className="flex flex-col gap-2">
                        <Label className="text-sm font-medium text-foreground">{label}</Label>
                        {def?.hint && (
                          <p className="text-xs text-muted-foreground -mt-1">{def.hint}</p>
                        )}
                        <Input
                          type={isTime ? 'time' : isNumber ? 'number' : 'text'}
                          min={isNumber ? 0 : undefined}
                          max={isPercent ? 100 : undefined}
                          step={isPercent ? String(VAT_PERCENT_INPUT_STEP) : '1'}
                          value={
                            isTime
                              ? toTimeInputValue(getValue(item.key, item.value), def?.value)
                              : getValue(item.key, item.value)
                          }
                          onChange={(e) => setFieldValue(item.key, e.target.value)}
                          onInput={(e) => setFieldValue(item.key, e.currentTarget.value)}
                          className={(() => {
                            const original = isTime
                              ? toTimeInputValue(item.value, def?.value)
                              : item.value
                            const current = isTime
                              ? toTimeInputValue(getValue(item.key, item.value), def?.value)
                              : getValue(item.key, item.value)
                            return current !== original
                              ? 'border-amber-400 ring-1 ring-amber-200'
                              : isTime
                                ? 'max-w-[10rem]'
                                : ''
                          })()}
                        />
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

