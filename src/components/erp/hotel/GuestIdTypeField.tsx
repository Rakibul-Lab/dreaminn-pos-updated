'use client'

import { useEffect, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { IdDocumentType } from '@/lib/id-ocr'
import {
  defaultIdTypeForNationality,
  getIdTypeOptionsForNationality,
} from '@/lib/id-type-label'

type GuestIdTypeFieldProps = {
  nationality?: string
  idType: IdDocumentType | ''
  onIdTypeChange: (type: IdDocumentType | '') => void
  required?: boolean
  allowUnset?: boolean
  label?: string
  className?: string
}

export function GuestIdTypeField({
  nationality = 'Bangladesh',
  idType,
  onIdTypeChange,
  required = false,
  allowUnset = false,
  label = 'Document type',
  className,
}: GuestIdTypeFieldProps) {
  const idTypeOptions = useMemo(
    () => getIdTypeOptionsForNationality(nationality),
    [nationality]
  )

  const effectiveIdType = idTypeOptions.some((opt) => opt.value === idType)
    ? idType
    : allowUnset
      ? ''
      : defaultIdTypeForNationality(nationality)

  useEffect(() => {
    if (allowUnset) return
    if (effectiveIdType !== idType && effectiveIdType) {
      onIdTypeChange(effectiveIdType)
    }
  }, [allowUnset, effectiveIdType, idType, onIdTypeChange])

  const selectValue = effectiveIdType || 'none'

  return (
    <div className={className ?? 'space-y-2'}>
      <Label className="text-xs">
        {label}
        {required ? ' *' : ''}
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) =>
          onIdTypeChange(v === 'none' ? '' : (v as IdDocumentType))
        }
      >
        <SelectTrigger className="h-9 bg-card w-full">
          <SelectValue placeholder="Select document type" />
        </SelectTrigger>
        <SelectContent>
          {allowUnset ? (
            <SelectItem value="none">None</SelectItem>
          ) : null}
          {idTypeOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.value === 'national_id' ? 'National ID (NID)' : opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
