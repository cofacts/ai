import { describe, expect, it } from 'vitest'

import { cn } from '../utils'

describe('cn', () => {
  it('keeps a typography token next to a text color', () => {
    expect(cn('text-type-body-m', 'text-text-primary')).toBe(
      'text-type-body-m text-text-primary',
    )
    expect(cn('text-type-ui-s-bold', 'text-text-on-accent')).toBe(
      'text-type-ui-s-bold text-text-on-accent',
    )
  })

  it('lets a later typography token override an earlier one', () => {
    expect(cn('text-type-heading-xl', 'text-type-heading-m')).toBe(
      'text-type-heading-m',
    )
  })

  it('lets a later text color override an earlier one', () => {
    expect(cn('text-text-primary', 'text-text-secondary')).toBe(
      'text-text-secondary',
    )
  })

  it('merges custom radius and shadow tokens', () => {
    expect(cn('rounded-radius-5', 'rounded-full')).toBe('rounded-full')
    expect(cn('shadow-btn-shadow', 'shadow-none')).toBe('shadow-none')
  })

  it('merges surface colors', () => {
    expect(cn('bg-surface-raised', 'bg-surface-base')).toBe('bg-surface-base')
  })

  it('merges border colors', () => {
    expect(cn('border-border-subtle', 'border-border-control')).toBe(
      'border-border-control',
    )
  })

  it('keeps text-base a font size, not a color', () => {
    expect(cn('text-base', 'text-text-primary')).toBe(
      'text-base text-text-primary',
    )
    expect(cn('text-sm', 'text-base')).toBe('text-base')
  })
})
