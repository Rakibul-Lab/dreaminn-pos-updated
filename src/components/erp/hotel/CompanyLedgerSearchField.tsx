'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms'

export interface CompanyLedgerSearchResult {
  id: string
  name: string
  contactPerson?: string | null
  phone?: string | null
  email?: string | null
}

interface CompanyLedgerSearchFieldProps {
  selectedLedgerId: string
  selectedLabel: string
  onSelect: (company: CompanyLedgerSearchResult) => void
  onClear: () => void
  /** Walk-in + ledger (default), or type a name / pick from ledger (corporate flows). */
  mode?: 'walkin-or-ledger' | 'manual-or-ledger'
  manualValue?: string
  onManualChange?: (name: string) => void
  placeholder?: string
}

function filterCompanies(
  companies: CompanyLedgerSearchResult[],
  query: string
): CompanyLedgerSearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return companies
  return companies.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.contactPerson?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
  )
}

export function CompanyLedgerSearchField({
  selectedLedgerId,
  selectedLabel,
  onSelect,
  onClear,
  mode = 'walkin-or-ledger',
  manualValue = '',
  onManualChange,
  placeholder,
}: CompanyLedgerSearchFieldProps) {
  const listboxId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const isManualOrLedger = mode === 'manual-or-ledger'
  const isWalkIn = !isManualOrLedger && !selectedLedgerId
  const closedDisplay = isManualOrLedger
    ? manualValue.trim() || selectedLabel.trim()
    : isWalkIn
      ? DEFAULT_GUEST_COMPANY
      : selectedLabel
  const searchQuery = inputValue.trim()

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setInputValue('')
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['company-ledger-all'],
    queryFn: () =>
      api.get<{ success: boolean; data: CompanyLedgerSearchResult[] }>(
        '/company-ledger?limit=500&activeOnly=true'
      ),
    enabled: open,
    staleTime: 60_000,
  })

  const allCompanies =
    ((data as { data?: CompanyLedgerSearchResult[] })?.data || []) as CompanyLedgerSearchResult[]

  const companyResults = useMemo(
    () => filterCompanies(allCompanies, inputValue),
    [allCompanies, inputValue]
  )

  const options: Array<
    | { type: 'walkin' }
    | { type: 'company'; company: CompanyLedgerSearchResult }
  > = isManualOrLedger
    ? companyResults.map((company) => ({ type: 'company' as const, company }))
    : [{ type: 'walkin' }, ...companyResults.map((company) => ({ type: 'company' as const, company }))]

  const showList = open
  const hasSearch = searchQuery.length > 0
  const canNavigate = showList && options.length > 0 && !isFetching

  useEffect(() => {
    if (!open) return
    if (isManualOrLedger) {
      setHighlightedIndex(companyResults.length > 0 ? 0 : -1)
      return
    }
    if (hasSearch && companyResults.length > 0) {
      setHighlightedIndex(1)
      return
    }
    if (!hasSearch) {
      setHighlightedIndex(0)
      return
    }
    setHighlightedIndex(-1)
  }, [open, hasSearch, companyResults.length, inputValue, isManualOrLedger])

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const selectWalkIn = () => {
    onClear()
    setInputValue('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const selectCompany = (company: CompanyLedgerSearchResult) => {
    onSelect(company)
    setInputValue('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const resolveEnterSelection = () => {
    if (isManualOrLedger) {
      if (hasSearch && companyResults.length > 0) {
        if (highlightedIndex >= 0) {
          const option = options[highlightedIndex]
          if (option?.type === 'company') return selectCompany(option.company)
        }
        return selectCompany(companyResults[0]!)
      }
      onManualChange?.(searchQuery)
      setInputValue('')
      setOpen(false)
      setHighlightedIndex(-1)
      return
    }

    if (!hasSearch) {
      if (highlightedIndex >= 1) {
        const option = options[highlightedIndex]
        if (option?.type === 'company') return selectCompany(option.company)
      }
      return selectWalkIn()
    }

    if (companyResults.length > 0) {
      if (highlightedIndex >= 1) {
        const company = companyResults[highlightedIndex - 1]
        if (company) return selectCompany(company)
      }
      return selectCompany(companyResults[0]!)
    }
  }

  const listStart = isManualOrLedger ? 0 : hasSearch && companyResults.length > 0 ? 1 : 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!showList) {
        setOpen(true)
        return
      }
      if (!canNavigate) return
      e.preventDefault()
      setHighlightedIndex((prev) => {
        if (prev < listStart) return listStart
        return prev < options.length - 1 ? prev + 1 : listStart
      })
      return
    }

    if (e.key === 'ArrowUp') {
      if (!canNavigate) return
      e.preventDefault()
      setHighlightedIndex((prev) => {
        if (prev <= listStart) return options.length - 1
        return prev - 1
      })
      return
    }

    if (e.key === 'Enter') {
      if (!showList) {
        setOpen(true)
        return
      }
      e.preventDefault()
      if (isFetching && allCompanies.length === 0) return
      resolveEnterSelection()
      return
    }

    if (e.key === 'Escape') {
      if (!showList) return
      e.preventDefault()
      setOpen(false)
      setInputValue('')
      setHighlightedIndex(-1)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={`${listboxId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-activedescendant={
          canNavigate && highlightedIndex >= 0
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        aria-autocomplete="list"
        value={open ? inputValue : closedDisplay}
        onChange={(e) => {
          const next = e.target.value
          setInputValue(next)
          setOpen(true)
          if (isManualOrLedger) {
            onManualChange?.(next)
            return
          }
          if (!next.trim()) {
            setHighlightedIndex(0)
          }
        }}
        onFocus={() => {
          setOpen(true)
          if (isManualOrLedger && manualValue.trim()) {
            setInputValue(manualValue)
          }
        }}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? (isManualOrLedger ? 'Type or search company…' : DEFAULT_GUEST_COMPANY)}
        className="pr-9"
        autoComplete="off"
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label="Open company list"
        onClick={() => {
          setOpen((prev) => !prev)
        }}
      >
        {isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover shadow-md"
          role="listbox"
        >
          {!isManualOrLedger ? (
          <li
            id={`${listboxId}-option-0`}
            role="option"
            data-index={0}
            aria-selected={isWalkIn || highlightedIndex === 0}
          >
            <button
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left text-sm focus:outline-none',
                highlightedIndex === 0
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50',
                isWalkIn && highlightedIndex !== 0 && 'bg-accent/30 font-medium'
              )}
              onMouseEnter={() => setHighlightedIndex(0)}
              onClick={selectWalkIn}
            >
              {DEFAULT_GUEST_COMPANY}
            </button>
          </li>
          ) : null}

          {isFetching && allCompanies.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground border-t">Loading companies…</li>
          ) : companyResults.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground border-t">
              {hasSearch
                ? isManualOrLedger
                  ? 'No ledger match — press Enter to use typed name'
                  : 'No companies found'
                : 'No companies in ledger yet'}
            </li>
          ) : (
            companyResults.map((company, index) => {
              const optionIndex = isManualOrLedger ? index : index + 1
              return (
                <li
                  key={company.id}
                  id={`${listboxId}-option-${optionIndex}`}
                  role="option"
                  data-index={optionIndex}
                  aria-selected={
                    highlightedIndex === optionIndex || selectedLedgerId === company.id
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm focus:outline-none',
                      highlightedIndex === optionIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50',
                      selectedLedgerId === company.id &&
                        highlightedIndex !== optionIndex &&
                        'font-medium'
                    )}
                    onMouseEnter={() => setHighlightedIndex(optionIndex)}
                    onClick={() => selectCompany(company)}
                  >
                    {company.name}
                    {(company.contactPerson || company.phone) && (
                      <span className="block text-xs text-muted-foreground font-normal">
                        {[company.contactPerson, company.phone].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
