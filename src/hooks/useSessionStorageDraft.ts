// Unsent text in an uncontrolled field, kept in sessionStorage so a reload, a
// visit to another page or Back finds the field as it was left. Per tab and
// gone when the tab closes, which suits what a person is still writing.
//
//   <Textarea {...useSessionStorageDraft('report.reason')} />
//
// The hook returns the field's own props, `ref` and `onInput`, to spread onto
// any input or textarea (our `Input` and `Textarea` pass both through to the
// native element). `onInput` rather than `onChange`, so the field keeps its own
// `onChange` free. Each field has its own key, `cofacts.draft.<id>`; whoever
// finishes with the text clears it with `clearSessionStorageDraft`, from any
// route — a draft is never cleared just because its field unmounts.
//
// Storage can be unavailable or throw (private mode, blocked site data, quota),
// so every access is wrapped: a failure means no draft, never a broken field.

import { useCallback } from 'react'
import type { FormEvent } from 'react'

type DraftElement = HTMLInputElement | HTMLTextAreaElement

const keyOf = (id: string) => `cofacts.draft.${id}`

function readDraft(id: string): string {
  try {
    return sessionStorage.getItem(keyOf(id)) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(id: string, value: string) {
  try {
    if (value) sessionStorage.setItem(keyOf(id), value)
    else sessionStorage.removeItem(keyOf(id))
  } catch {
    // No draft, then.
  }
}

/** Whether any of these fields has unsent text saved. */
export function hasSessionStorageDraft(...ids: Array<string>): boolean {
  return ids.some((id) => readDraft(id) !== '')
}

/** Forget these fields' drafts, once their text has been sent. */
export function clearSessionStorageDraft(...ids: Array<string>) {
  for (const id of ids) writeDraft(id, '')
}

/**
 * Props that keep an uncontrolled input or textarea's value as a draft:
 * every input saves it (an empty field removes it), and the draft fills the
 * field when it attaches.
 *
 * The fill happens in a callback ref, which runs only in the browser, after
 * hydration — sessionStorage does not exist during SSR. It never overwrites
 * text typed before hydration finished.
 */
export function useSessionStorageDraft(id: string) {
  const ref = useCallback(
    (el: DraftElement | null) => {
      if (!el || el.value) return
      const draft = readDraft(id)
      if (draft) el.value = draft
    },
    [id],
  )
  const onInput = useCallback(
    (e: FormEvent<DraftElement>) => writeDraft(id, e.currentTarget.value),
    [id],
  )
  return { ref, onInput }
}
