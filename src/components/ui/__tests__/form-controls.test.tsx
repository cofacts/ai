// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Checkbox } from '../checkbox'
import { RadioGroup, RadioGroupItem } from '../radio-group'
import { Switch } from '../switch'

// a11y guide: the title is bound with <label>. Base UI renders a role element next to a hidden
// <input>, so the role element must be labelable itself for <label> to name it.
describe('form controls wrapped in <label>', () => {
  it('names a Checkbox', () => {
    render(
      <label>
        <Checkbox />
        只看有回應的
      </label>,
    )
    expect(screen.getByRole('checkbox', { name: '只看有回應的' })).toBeTruthy()
  })

  it('names a Switch', () => {
    render(
      <label>
        <Switch />
        通知
      </label>,
    )
    expect(screen.getByRole('switch', { name: '通知' })).toBeTruthy()
  })

  it('names each Radio', () => {
    render(
      <RadioGroup>
        <label>
          <RadioGroupItem value="a" />甲
        </label>
        <label>
          <RadioGroupItem value="b" />乙
        </label>
      </RadioGroup>,
    )
    expect(screen.getByRole('radio', { name: '甲' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '乙' })).toBeTruthy()
  })

  it('toggles once when the label text is clicked', () => {
    render(
      <>
        <label>
          <Checkbox />
          勾選
        </label>
        <label>
          <Switch />
          開關
        </label>
      </>,
    )
    fireEvent.click(screen.getByText('勾選'))
    fireEvent.click(screen.getByText('開關'))
    expect(
      screen
        .getByRole('checkbox', { name: '勾選' })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      screen.getByRole('switch', { name: '開關' }).getAttribute('aria-checked'),
    ).toBe('true')
  })
})
