'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CompanyLedgerSearchField } from '@/components/erp/hotel/CompanyLedgerSearchField'

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
  companyLedgerId?: string
  onCompanyLedgerSelect?: (company: { id: string; name: string }) => void
  onCompanyManualChange?: (name: string) => void
  onRemove?: () => void
}

export function CorporateCompanionGuestFields({
  label,
  value,
  onChange,
  companyLedgerId = '',
  onCompanyLedgerSelect,
  onCompanyManualChange,
  onRemove,
}: CorporateCompanionGuestFieldsProps) {
  const handleCompanyManual = (name: string) => {
    onChange({ company: name })
    onCompanyManualChange?.(name)
  }

  const handleCompanySelect = (company: { id: string; name: string }) => {
    onChange({ company: company.name })
    onCompanyLedgerSelect?.(company)
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-4 space-y-3">
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
          <Input value={value.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Phone *</Label>
          <Input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Company name *</Label>
          <CompanyLedgerSearchField
            mode="manual-or-ledger"
            manualValue={value.company}
            selectedLedgerId={companyLedgerId}
            selectedLabel={value.company}
            onManualChange={handleCompanyManual}
            onSelect={handleCompanySelect}
            onClear={() => handleCompanyManual('')}
            placeholder="Type or search company…"
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
