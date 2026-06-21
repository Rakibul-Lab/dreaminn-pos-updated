'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type EmailValidationResult,
  type EmailValidationStatus,
  resolveOptionalEmailValidation,
  validateEmailFormat,
} from '@/lib/email-validation'

type UseEmailValidationOptions = {
  email: string
  optional?: boolean
  debounceMs?: number
}

const IDLE: EmailValidationResult = { valid: true, status: 'idle' }

export function useEmailValidation({
  email,
  optional = false,
  debounceMs = 400,
}: UseEmailValidationOptions) {
  const [result, setResult] = useState<EmailValidationResult>(IDLE)
  const requestId = useRef(0)

  const runValidation = useCallback(() => {
    const trimmed = email.trim()
    if (optional && !trimmed) {
      setResult(IDLE)
      return
    }

    if (trimmed.length < 5 || !trimmed.includes('@')) {
      setResult({
        valid: false,
        status: 'idle',
        message: trimmed ? 'Keep typing…' : undefined,
      })
      return
    }

    const format = validateEmailFormat(trimmed)
    const next: EmailValidationResult = format.valid
      ? { valid: true, status: 'valid', message: 'Valid email format' }
      : { valid: false, status: 'invalid', message: format.message }

    setResult(resolveOptionalEmailValidation(email, next, optional))
  }, [email, optional])

  useEffect(() => {
    const trimmed = email.trim()
    if (optional && !trimmed) {
      setResult(IDLE)
      return
    }

    if (trimmed.length < 5 || !trimmed.includes('@')) {
      setResult({
        valid: false,
        status: 'idle',
        message: trimmed ? 'Keep typing…' : undefined,
      })
      return
    }

    const currentRequest = ++requestId.current
    setResult((prev) => ({
      ...prev,
      status: 'validating' as EmailValidationStatus,
      message: 'Checking format…',
    }))

    const timer = window.setTimeout(() => {
      if (currentRequest !== requestId.current) return
      runValidation()
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [email, optional, debounceMs, runValidation])

  const resolved = resolveOptionalEmailValidation(email, result, optional)
  const isBlocking = (() => {
    if (optional && !email.trim()) return false
    return !resolved.valid && resolved.status !== 'idle'
  })()

  return {
    ...resolved,
    isBlocking,
    revalidate: runValidation,
  }
}

export type { EmailValidationResult, EmailValidationStatus }
