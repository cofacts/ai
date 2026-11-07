// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  clearSessionStorageDraft,
  hasSessionStorageDraft,
  useSessionStorageDraft,
} from '../useSessionStorageDraft'
import type { FormEvent } from 'react'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

/** Types into the field the way the browser does: value, then `input`. */
function typeInto(
  el: HTMLTextAreaElement,
  value: string,
  onInput: (e: FormEvent<HTMLTextAreaElement>) => void,
) {
  el.value = value
  onInput({ currentTarget: el } as FormEvent<HTMLTextAreaElement>)
}

describe('useSessionStorageDraft', () => {
  test('saves on input, and an emptied field removes the draft', () => {
    const { result } = renderHook(() => useSessionStorageDraft('t.a'))
    const el = document.createElement('textarea')

    typeInto(el, 'hello', result.current.onInput)
    expect(sessionStorage.getItem('cofacts.draft.t.a')).toBe('hello')

    typeInto(el, '', result.current.onInput)
    expect(sessionStorage.getItem('cofacts.draft.t.a')).toBeNull()
  })

  test('fills an empty field with the draft when it attaches', () => {
    sessionStorage.setItem('cofacts.draft.t.a', 'saved')
    const { result } = renderHook(() => useSessionStorageDraft('t.a'))
    const el = document.createElement('textarea')

    result.current.ref(el)

    expect(el.value).toBe('saved')
  })

  test('never overwrites what was typed before it attached', () => {
    sessionStorage.setItem('cofacts.draft.t.a', 'saved')
    const { result } = renderHook(() => useSessionStorageDraft('t.a'))
    const el = document.createElement('textarea')
    el.value = 'typed early'

    result.current.ref(el)

    expect(el.value).toBe('typed early')
  })

  test('treats unusable storage as no draft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useSessionStorageDraft('t.a'))
    const el = document.createElement('textarea')

    expect(() => result.current.ref(el)).not.toThrow()
    expect(el.value).toBe('')
    expect(() => typeInto(el, 'x', result.current.onInput)).not.toThrow()
    expect(hasSessionStorageDraft('t.a')).toBe(false)
  })
})

describe('hasSessionStorageDraft / clearSessionStorageDraft', () => {
  test('cover any of several fields', () => {
    expect(hasSessionStorageDraft('t.a', 't.b')).toBe(false)

    sessionStorage.setItem('cofacts.draft.t.b', 'x')
    expect(hasSessionStorageDraft('t.a', 't.b')).toBe(true)

    sessionStorage.setItem('cofacts.draft.t.a', 'y')
    sessionStorage.setItem('cofacts.draft.other', 'z')
    clearSessionStorageDraft('t.a', 't.b')
    expect(hasSessionStorageDraft('t.a', 't.b')).toBe(false)
    // Only the named fields.
    expect(sessionStorage.getItem('cofacts.draft.other')).toBe('z')
  })
})
