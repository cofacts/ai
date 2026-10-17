import { describe, expect, it } from 'vitest'

import { cn } from '../utils'

describe('cn', () => {
  it('keeps a typography token next to a text color', () => {
    expect(cn('text-body-m', 'text-primary')).toBe('text-body-m text-primary')
    expect(cn('text-ui-s-bold', 'text-on-accent')).toBe(
      'text-ui-s-bold text-on-accent',
    )
  })

  it('lets a later typography token override an earlier one', () => {
    expect(cn('text-heading-xl', 'text-heading-m')).toBe('text-heading-m')
  })

  it('lets a later text color override an earlier one', () => {
    expect(cn('text-primary', 'text-secondary')).toBe('text-secondary')
  })

  it('merges custom radius and shadow tokens', () => {
    expect(cn('rounded-5', 'rounded-full')).toBe('rounded-full')
    expect(cn('shadow-btn', 'shadow-none')).toBe('shadow-none')
  })

  it('merges surface colors', () => {
    expect(cn('bg-raised', 'bg-base')).toBe('bg-base')
  })
})
