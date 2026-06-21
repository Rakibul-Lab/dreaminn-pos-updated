'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  type EmailValidationResult,
  useEmailValidation,
} from '@/hooks/use-email-validation'

export type EmailInputProps = Omit<React.ComponentProps<typeof Input>, 'type' | 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  optional?: boolean
  /** @deprecated Kept for compatibility; format-only validation is always used. */
  mode?: 'full' | 'format-only'
  /** @deprecated No longer used. */
  allowUnverifiedMailbox?: boolean
  showMessage?: boolean
  onValidationChange?: (result: EmailValidationResult & { isBlocking: boolean }) => void
}

export function EmailInput({
  value,
  onChange,
  optional = false,
  showMessage = true,
  onValidationChange,
  className,
  id,
  mode: _mode,
  allowUnverifiedMailbox: _allowUnverifiedMailbox,
  ...props
}: EmailInputProps) {
  const validation = useEmailValidation({ email: value, optional })
  const onValidationChangeRef = React.useRef(onValidationChange)

  React.useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])

  React.useEffect(() => {
    onValidationChangeRef.current?.({
      ...validation,
      isBlocking: validation.isBlocking,
    })
  }, [validation.valid, validation.status, validation.message, validation.isBlocking])

  const statusIcon = (() => {
    if (optional && !value.trim()) return null
    switch (validation.status) {
      case 'validating':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case 'valid':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      case 'invalid':
        return <XCircle className="h-4 w-4 text-destructive" />
      default:
        return null
    }
  })()

  const showFeedback =
    showMessage &&
    validation.message &&
    !(optional && !value.trim()) &&
    validation.status !== 'idle'

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          id={id}
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={validation.isBlocking || undefined}
          className={cn(statusIcon && 'pr-9', className)}
          autoComplete="email"
          {...props}
        />
        {statusIcon && (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            {statusIcon}
          </div>
        )}
      </div>

      {showFeedback && (
        <p
          className={cn(
            'text-xs',
            validation.status === 'valid' && 'text-emerald-600',
            validation.status === 'invalid' && 'text-destructive',
            validation.status === 'validating' && 'text-muted-foreground'
          )}
        >
          {validation.message}
        </p>
      )}
    </div>
  )
}
