'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { ChevronDown, Loader2, X } from 'lucide-react'
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
  const trimmedLabel = selectedLabel.trim()
  // A booking can carry a plain company name without a ledger link (typed on the
  // reservation entry). Showing walk-in in that case hides a real company.
  const hasPlainCompanyName = Boolean(trimmedLabel) && trimmedLabel !== DEFAULT_GUEST_COMPANY
  const isWalkIn = !selectedLedgerId && !hasPlainCompanyName && !manualValue.trim()
  const closedDisplay = isManualOrLedger
    ? (manualValue.trim() && manualValue.trim() !== DEFAULT_GUEST_COMPANY
        ? manualValue.trim()
        : hasPlainCompanyName
          ? trimmedLabel
          : '')
    : isWalkIn
      ? DEFAULT_GUEST_COMPANY
      : trimmedLabel
  const searchQuery = inputValue.trim()

  const hasActiveCompany = Boolean(
    selectedLedgerId ||
      (isManualOrLedger
        ? (manualValue.trim() && manualValue.trim() !== DEFAULT_GUEST_COMPANY) || hasPlainCompanyName
        : !isWalkIn)
  )

  useEffect(() => {
    if (!open) {
      setInputValue(closedDisplay)
    }
  }, [open, closedDisplay])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        if (isManualOrLedger) {
          const typed = inputValue.trim()
          if (typed && typed !== DEFAULT_GUEST_COMPANY) {
            onManualChange?.(typed)
            setInputValue(typed)
          } else {
            onClear()
            setInputValue('')
          }
        }
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, inputValue, isManualOrLedger, onManualChange, onClear])

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

  type Option =
    | { type: 'custom'; name: string }
    | { type: 'company'; company: CompanyLedgerSearchResult }
    | { type: 'walkin' }

  const options: Option[] = useMemo(() => {
    if (isManualOrLedger) {
      const list: Option[] = []
      if (searchQuery && searchQuery !== DEFAULT_GUEST_COMPANY) {
        list.push({ type: 'custom', name: searchQuery })
      }
      for (const company of companyResults) {
        list.push({ type: 'company', company })
      }
      list.push({ type: 'walkin' })
      return list
    }
    return [
      { type: 'walkin' },
      ...companyResults.map((company) => ({ type: 'company' as const, company })),
    ]
  }, [isManualOrLedger, searchQuery, companyResults])

  const showList = open
  const hasSearch = searchQuery.length > 0
  const canNavigate = showList && options.length > 0 && !isFetching

  useEffect(() => {
    if (!open) return
    if (isManualOrLedger) {
      setHighlightedIndex(searchQuery && searchQuery !== DEFAULT_GUEST_COMPANY ? 0 : (companyResults.length > 0 ? 0 : -1))
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
  }, [open, hasSearch, companyResults.length, inputValue, isManualOrLedger, searchQuery])

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const selectCustom = (name: string) => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== DEFAULT_GUEST_COMPANY) {
      onManualChange?.(trimmed)
      setInputValue(trimmed)
    } else {
      onClear()
      setInputValue('')
    }
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const selectWalkIn = () => {
    onClear()
    setInputValue('')
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const selectCompany = (company: CompanyLedgerSearchResult) => {
    onSelect(company)
    setInputValue(company.name)
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const resolveEnterSelection = () => {
    if (isManualOrLedger) {
      if (highlightedIndex >= 0 && highlightedIndex < options.length) {
        const option = options[highlightedIndex]
        if (option?.type === 'company') return selectCompany(option.company)
        if (option?.type === 'walkin') return selectWalkIn()
        if (option?.type === 'custom') return selectCustom(option.name)
      }
      if (searchQuery) {
        return selectCustom(searchQuery)
      }
      return selectWalkIn()
    }

    if (!hasSearch) {
      if (highlightedIndex >= 1 && highlightedIndex < options.length) {
        const option = options[highlightedIndex]
        if (option?.type === 'company') return selectCompany(option.company)
      }
      return selectWalkIn()
    }

    if (companyResults.length > 0) {
      if (highlightedIndex >= 1 && highlightedIndex <= companyResults.length) {
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
      setInputValue(closedDisplay)
      setHighlightedIndex(-1)
    }
  }

  const hasCustomOption = Boolean(isManualOrLedger && searchQuery && searchQuery !== DEFAULT_GUEST_COMPANY)

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
          if (isManualOrLedger) {
            setInputValue(closedDisplay)
          }
        }}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? (isManualOrLedger ? 'Type or search company…' : DEFAULT_GUEST_COMPANY)}
        className={cn(hasActiveCompany ? 'pr-16' : 'pr-9')}
        autoComplete="off"
      />
      <div className="absolute right-0 top-0 flex h-full items-center pr-1.5">
        {hasActiveCompany && (
          <button
            type="button"
            tabIndex={-1}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Reset to walk-in"
            title="Reset to walk-in"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              selectWalkIn()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Open company list"
          onClick={() => {
            setOpen((prev) => {
              const next = !prev
              if (next && isManualOrLedger) {
                setInputValue(closedDisplay)
              }
              return next
            })
          }}
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          )}
        </button>
      </div>

      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md divide-y divide-border/40"
          role="listbox"
        >
          {hasCustomOption ? (
            <li
              id={`${listboxId}-option-0`}
              role="option"
              data-index={0}
              aria-selected={highlightedIndex === 0}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm focus:outline-none flex items-center justify-between gap-2',
                  highlightedIndex === 0
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
                onMouseEnter={() => setHighlightedIndex(0)}
                onClick={() => selectCustom(searchQuery)}
              >
                <div className="min-w-0">
                  <span className="font-medium text-foreground">
                    Use &ldquo;{searchQuery}&rdquo;
                  </span>
                  <span className="block text-xs text-muted-foreground font-normal">
                    Plain company name (no ledger account)
                  </span>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 shrink-0">
                  Custom
                </span>
              </button>
            </li>
          ) : null}

          {isManualOrLedger && companyResults.length > 0 && (
            <li className="px-3 py-1.5 bg-muted/60 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Matching Company Ledgers
            </li>
          )}

          {!isManualOrLedger ? (
            <li
              id={`${listboxId}-option-0`}
              role="option"
              data-index={0}
              aria-selected={isWalkIn || highlightedIndex === 0}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
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
          ) : companyResults.length === 0 && (!isManualOrLedger || !searchQuery) ? (
            <li className="px-3 py-2 text-sm text-muted-foreground border-t">
              {hasSearch ? 'No companies found' : 'No companies in ledger yet'}
            </li>
          ) : (
            companyResults.map((company, index) => {
              const optionIndex =
                (hasCustomOption ? 1 : 0) + (isManualOrLedger ? 0 : 1) + index
              const isSelected = selectedLedgerId === company.id
              return (
                <li
                  key={company.id}
                  id={`${listboxId}-option-${optionIndex}`}
                  role="option"
                  data-index={optionIndex}
                  aria-selected={highlightedIndex === optionIndex || isSelected}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm focus:outline-none flex items-center justify-between gap-2',
                      highlightedIndex === optionIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50',
                      isSelected && 'font-medium'
                    )}
                    onMouseEnter={() => setHighlightedIndex(optionIndex)}
                    onClick={() => selectCompany(company)}
                  >
                    <div className="min-w-0">
                      <span className="truncate block font-medium">{company.name}</span>
                      {(company.contactPerson || company.phone) && (
                        <span className="block text-xs text-muted-foreground font-normal truncate">
                          {[company.contactPerson, company.phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    {isManualOrLedger && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
                        Ledger
                      </span>
                    )}
                  </button>
                </li>
              )
            })
          )}

          {isManualOrLedger ? (
            <li
              id={`${listboxId}-option-walkin`}
              role="option"
              data-index={options.length - 1}
              aria-selected={isWalkIn}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm focus:outline-none text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  isWalkIn && 'bg-accent/30 font-medium text-foreground'
                )}
                onMouseEnter={() => setHighlightedIndex(options.length - 1)}
                onClick={selectWalkIn}
              >
                {DEFAULT_GUEST_COMPANY} (No company)
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}
