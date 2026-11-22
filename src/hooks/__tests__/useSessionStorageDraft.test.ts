// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  clearSessionStorageDraft,
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
    vi.restoreAllMocks()
    expect(sessionStorage.getItem('cofacts.draft.t.a')).toBeNull()
  })
})

describe('clearSessionStorageDraft', () => {
  test('clears several fields at once', () => {
    sessionStorage.setItem('cofacts.draft.t.a', 'y')
    sessionStorage.setItem('cofacts.draft.t.b', 'x')
    sessionStorage.setItem('cofacts.draft.other', 'z')
    clearSessionStorageDraft('t.a', 't.b')
    expect(sessionStorage.getItem('cofacts.draft.t.a')).toBeNull()
    expect(sessionStorage.getItem('cofacts.draft.t.b')).toBeNull()
    // Only the named fields.
    expect(sessionStorage.getItem('cofacts.draft.other')).toBe('z')
  })
})
