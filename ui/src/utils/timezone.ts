export interface TimezoneOption {
  value: string
  label: string
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'UTC', label: 'UTC' },
  // Americas
  { value: 'America/New_York',    label: 'New York (ET)' },
  { value: 'America/Chicago',     label: 'Chicago (CT)' },
  { value: 'America/Denver',      label: 'Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Anchorage',   label: 'Anchorage (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Honolulu (HT)' },
  { value: 'America/Toronto',     label: 'Toronto (ET)' },
  { value: 'America/Vancouver',   label: 'Vancouver (PT)' },
  { value: 'America/Mexico_City', label: 'Mexico City (CT)' },
  { value: 'America/Sao_Paulo',   label: 'São Paulo (BRT)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART)' },
  { value: 'America/Bogota',      label: 'Bogotá (COT)' },
  { value: 'America/Lima',        label: 'Lima (PET)' },
  { value: 'America/Santiago',    label: 'Santiago (CLT)' },
  // Europe
  { value: 'Europe/London',       label: 'London (GMT/BST)' },
  { value: 'Europe/Dublin',       label: 'Dublin (GMT/IST)' },
  { value: 'Europe/Lisbon',       label: 'Lisbon (WET)' },
  { value: 'Europe/Paris',        label: 'Paris (CET)' },
  { value: 'Europe/Berlin',       label: 'Berlin (CET)' },
  { value: 'Europe/Rome',         label: 'Rome (CET)' },
  { value: 'Europe/Madrid',       label: 'Madrid (CET)' },
  { value: 'Europe/Amsterdam',    label: 'Amsterdam (CET)' },
  { value: 'Europe/Stockholm',    label: 'Stockholm (CET)' },
  { value: 'Europe/Warsaw',       label: 'Warsaw (CET)' },
  { value: 'Europe/Helsinki',     label: 'Helsinki (EET)' },
  { value: 'Europe/Athens',       label: 'Athens (EET)' },
  { value: 'Europe/Bucharest',    label: 'Bucharest (EET)' },
  { value: 'Europe/Istanbul',     label: 'Istanbul (TRT)' },
  { value: 'Europe/Moscow',       label: 'Moscow (MSK)' },
  { value: 'Europe/Kiev',         label: 'Kyiv (EET)' },
  // Africa
  { value: 'Africa/Cairo',        label: 'Cairo (EET)' },
  { value: 'Africa/Lagos',        label: 'Lagos (WAT)' },
  { value: 'Africa/Nairobi',      label: 'Nairobi (EAT)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  // Middle East / Asia
  { value: 'Asia/Dubai',          label: 'Dubai (GST)' },
  { value: 'Asia/Riyadh',         label: 'Riyadh (AST)' },
  { value: 'Asia/Tehran',         label: 'Tehran (IRST)' },
  { value: 'Asia/Karachi',        label: 'Karachi (PKT)' },
  { value: 'Asia/Kolkata',        label: 'Kolkata (IST)' },
  { value: 'Asia/Dhaka',          label: 'Dhaka (BST)' },
  { value: 'Asia/Bangkok',        label: 'Bangkok (ICT)' },
  { value: 'Asia/Ho_Chi_Minh',    label: 'Ho Chi Minh (ICT)' },
  { value: 'Asia/Jakarta',        label: 'Jakarta (WIB)' },
  { value: 'Asia/Kuala_Lumpur',   label: 'Kuala Lumpur (MYT)' },
  { value: 'Asia/Singapore',      label: 'Singapore (SGT)' },
  { value: 'Asia/Manila',         label: 'Manila (PHT)' },
  { value: 'Asia/Shanghai',       label: 'Shanghai (CST)' },
  { value: 'Asia/Hong_Kong',      label: 'Hong Kong (HKT)' },
  { value: 'Asia/Taipei',         label: 'Taipei (CST)' },
  { value: 'Asia/Seoul',          label: 'Seoul (KST)' },
  { value: 'Asia/Tokyo',          label: 'Tokyo (JST)' },
  // Pacific / Australia
  { value: 'Australia/Perth',     label: 'Perth (AWST)' },
  { value: 'Australia/Darwin',    label: 'Darwin (ACST)' },
  { value: 'Australia/Brisbane',  label: 'Brisbane (AEST)' },
  { value: 'Australia/Sydney',    label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland',    label: 'Auckland (NZST)' },
  { value: 'Pacific/Fiji',        label: 'Fiji (FJT)' },
]

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Convert a naive "YYYY-MM-DDTHH:MM" string interpreted in `timezone` to a UTC ISO string.
// Uses a two-iteration offset adjustment that correctly handles DST transitions.
export function naiveDatetimeToUtc(localStr: string, timezone: string): string {
  if (!localStr) return localStr
  if (!timezone || timezone === 'UTC') return new Date(localStr + ':00Z').toISOString()

  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return new Date(localStr).toISOString()

  const [, yr, mo, dy, hr, mn] = m.map(Number)

  // Start with the naive datetime treated as UTC, then adjust for the real offset.
  let guess = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0))

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })

  for (let i = 0; i < 2; i++) {
    const p: Record<string, number> = {}
    for (const { type, value } of fmt.formatToParts(guess)) {
      if (type !== 'literal') p[type] = Number(value)
    }
    // hour can be 24 for midnight in some environments
    const shown = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second ?? 0))
    const desired = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0))
    guess = new Date(guess.getTime() + (desired.getTime() - shown.getTime()))
  }

  return guess.toISOString()
}

// Convert a UTC ISO string to a naive "YYYY-MM-DDTHH:MM" string in the given timezone.
// This is the inverse of naiveDatetimeToUtc — used to fill datetime-local inputs from UTC suggestions.
export function utcToNaiveDatetimeString(utcIso: string, timezone: string): string {
  const date = new Date(utcIso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

// Return the short timezone abbreviation shown in the UI badge.
export function getTimezoneAbbr(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone
  } catch {
    return timezone
  }
}
