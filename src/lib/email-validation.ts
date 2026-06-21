import { z } from 'zod'

export type EmailValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid'

export type EmailValidationResult = {
  valid: boolean
  status: EmailValidationStatus
  message?: string
}

const emailSchema = z.string().email()

/** Client-safe format check */
export function validateEmailFormat(email: string): { valid: boolean; message?: string } {
  const trimmed = email.trim()
  if (!trimmed) {
    return { valid: false, message: 'Email is required' }
  }
  const parsed = emailSchema.safeParse(trimmed)
  if (!parsed.success) {
    return { valid: false, message: 'Enter a valid email address' }
  }
  return { valid: true }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getEmailDomain(email: string): string | null {
  const trimmed = normalizeEmail(email)
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return null
  return trimmed.slice(at + 1)
}

export function resolveOptionalEmailValidation(
  email: string,
  result: EmailValidationResult,
  optional: boolean
): EmailValidationResult {
  if (optional && !email.trim()) {
    return { valid: true, status: 'idle' }
  }
  return result
}

/** Returns an error message when invalid, or null when OK. */
export function getEmailValidationError(
  email: string | null | undefined,
  optional = false
): string | null {
  const trimmed = email?.trim() ?? ''
  if (!trimmed) {
    return optional ? null : 'Email is required'
  }
  const result = validateEmailFormat(trimmed)
  return result.valid ? null : result.message || 'Enter a valid email address'
}
