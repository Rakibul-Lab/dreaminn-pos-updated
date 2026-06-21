'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type CorporateCompanionDraft = {
  name: string
  company: string
  phone: string
  designation: string
  address: string
}

export function emptyCorporateCompanionDraft(): CorporateCompanionDraft {
  return {
    name: '',
    company: '',
    phone: '',
    designation: '',
    address: '',
  }
}

type CorporateCompanionGuestFieldsProps = {
  label: string
  value: CorporateCompanionDraft
  onChange: (patch: Partial<CorporateCompanionDraft>) => void
}

export function CorporateCompanionGuestFields({
  label,
  value,
  onChange,
}: CorporateCompanionGuestFieldsProps) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Full name *</Label>
          <Input value={value.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Phone *</Label>
          <Input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Company name *</Label>
          <Input
            value={value.company}
            onChange={(e) => onChange({ company: e.target.value })}
            placeholder="Type company name"
          />
        </div>
        <div className="space-y-1">
          <Label>Designation *</Label>
          <Input
            value={value.designation}
            onChange={(e) => onChange({ designation: e.target.value })}
            placeholder="e.g. Manager, Director"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Address *</Label>
          <Input value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
        </div>
      </div>
    </div>
  )
}
