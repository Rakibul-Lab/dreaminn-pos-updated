'use client'

import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NationalityField } from '@/components/erp/shared/NationalityField'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { IdDocumentType } from '@/lib/id-ocr'
import {
  DEFAULT_NATIONALITY,
  getIdTypeOptionsForNationality,
  resolveIdTypeForNationality,
} from '@/lib/id-type-label'

export type CompanionGuestDraft = {
  name: string
  phone: string
  guestNationality: string
  idType: IdDocumentType
  idNumber: string
}

export function emptyCompanionDraft(): CompanionGuestDraft {
  return {
    name: '',
    phone: '',
    guestNationality: DEFAULT_NATIONALITY,
    idType: 'national_id',
    idNumber: '',
  }
}

type CompanionGuestFieldsProps = {
  label: string
  value: CompanionGuestDraft
  requireId?: boolean
  onChange: (patch: Partial<CompanionGuestDraft>) => void
  onRemove?: () => void
}

export function CompanionGuestFields({
  label,
  value,
  requireId = true,
  onChange,
  onRemove,
}: CompanionGuestFieldsProps) {
  const idTypeOptions = useMemo(
    () => getIdTypeOptionsForNationality(value.guestNationality),
    [value.guestNationality]
  )

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Full name *</Label>
          <Input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Phone *</Label>
          <Input
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <NationalityField
            value={value.guestNationality}
            onChange={(nationality) =>
              onChange({
                guestNationality: nationality,
                idType: resolveIdTypeForNationality(nationality, value.idType),
              })
            }
            label="Nationality *"
            placeholder="Select nationality…"
          />
        </div>
        <div className="space-y-1">
          <Label>ID type</Label>
          <Select
            value={value.idType}
            onValueChange={(idType) => onChange({ idType: idType as IdDocumentType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {idTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.value === 'national_id' ? 'National ID (NID)' : opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>NID / Passport number{requireId ? ' *' : ''}</Label>
          <Input
            value={value.idNumber}
            onChange={(e) => onChange({ idNumber: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
