/** Parse login session tokens: `${userId}-${timestamp}-${random}`. */
export type ParsedSessionToken = {
  userId: string
  issuedAt: number
}

export function parseSessionToken(token: string | null | undefined): ParsedSessionToken | null {
  if (!token || typeof token !== 'string') return null

  const trimmed = token.trim()
  if (!trimmed) return null

  const firstDash = trimmed.indexOf('-')
  if (firstDash <= 0) return null

  const userId = trimmed.slice(0, firstDash)
  if (!userId) return null

  const rest = trimmed.slice(firstDash + 1)
  const secondDash = rest.indexOf('-')
  if (secondDash <= 0) return null

  const issuedAt = Number(rest.slice(0, secondDash))
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null

  const randomPart = rest.slice(secondDash + 1)
  if (!randomPart || randomPart.length < 2) return null

  return { userId, issuedAt }
}

export function sessionTokenMatchesUser(token: string | null | undefined, userId: string | null | undefined): boolean {
  if (!userId) return false
  const parsed = parseSessionToken(token)
  return parsed !== null && parsed.userId === userId
}
