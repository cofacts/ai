// /report — the report form (Penpot 01-回報可疑訊息): paste the link to a
// suspicious message and, optionally, why it looks wrong.
//
// Deliberately not a conversation. Everything filed here is public, and a form
// is the right container for that — it shows exactly what will be submitted,
// with no model in between deciding what the user meant. The AI is one button
// away at the end, by which point there is an article for it to work on, which
// is the only input `ai_writer` has ever wanted.
//
// The form talks to no server. Submitting hands `url` and `reason` to
// /report/check in history state, which searches and writes. The inputs are
// uncontrolled; each keeps what has been typed as a draft in sessionStorage
// (useSessionStorageDraft), which refills the form after a reload or on Back
// from /report/check, until /report/check completes the report and clears it.

import {
  createFileRoute,
  useBlocker,
  useNavigate,
} from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { ReportShell } from './-components/ReportShell'
import type { FormEvent } from 'react'
import { useSessionStorageDraft } from '@/hooks/useSessionStorageDraft'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/report/')({
  component: ReportFormPage,
  head: () => ({
    meta: [
      { title: '回報可疑訊息 — Cofacts.ai' },
      {
        name: 'description',
        content:
          '貼上正在流傳的訊息連結，看看有沒有人回報過、有沒有查核回應，也可以請大家一起查。',
      },
    ],
  }),
})

function ReportFormPage() {
  return (
    <ReportShell>
      <ReportForm />
    </ReportShell>
  )
}

/**
 * Why the link field refuses what is in it, or null when it shows nothing.
 */
type UrlError = 'missing' | 'format' | null

function urlErrorOf(input: HTMLInputElement): UrlError {
  if (input.validity.valid) return null
  return input.validity.valueMissing ? 'missing' : 'format'
}

/** The draft ids of the form's two fields; /report/check clears them. */
const URL_DRAFT = 'report.url'
const REASON_DRAFT = 'report.reason'

/** Whether the form holds anything a reload or tab close would throw away. */
function hasUnsentText(form: HTMLFormElement | null): boolean {
  if (!form) return false
  return [...new FormData(form).values()].some(
    (value) => typeof value === 'string' && value.trim() !== '',
  )
}

function ReportForm() {
  const navigate = useNavigate()
  const [urlError, setUrlError] = useState<UrlError>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const urlDraft = useSessionStorageDraft(URL_DRAFT)
  const reasonDraft = useSessionStorageDraft(REASON_DRAFT)

  // In-app navigation is never blocked: submitting goes to /report/check, and
  // the draft covers leaving through the site nav.
  useBlocker({
    shouldBlockFn: () => false,
    enableBeforeUnload: () => hasUnsentText(formRef.current),
  })

  // Only reached once the browser's constraint validation has passed: the
  // form refuses to submit anything but one http(s) link. The draft stays
  // until /report/check completes the report.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    void navigate({
      to: '/report/check',
      state: {
        url: String(data.get('url') ?? '').trim(),
        reason: String(data.get('reason') ?? ''),
      },
    })
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-spacing-16"
      onSubmit={onSubmit}
    >
      <Field>
        <Label htmlFor="report-url">訊息的網址</Label>
        {/* A visible hint rather than a placeholder, which is not a label and
            disappears the moment the reporter starts pasting. */}
        <p
          id="report-url-hint"
          className="text-type-body-s text-text-secondary"
        >
          例：https://www.facebook.com/share/p/…
        </p>
        {/*
          The error appears only when the reporter tries to submit (the
          input's `invalid` event) — never on load, while typing, or on blur.
          Shown on blur, it would push the submit button down between press
          and release and swallow the click (a tap on mobile, where focus
          moves only after the finger lifts, included); shown by the submit
          itself, nothing moves under the pointer. Once shown, editing keeps it
          accurate and clears it as soon as the value is valid. The browser's
          own bubble is suppressed because our message carries a link it
          cannot show.
        */}
        <Input
          id="report-url"
          type="url"
          name="url"
          required
          // An http(s) link and nothing else: the scheme in any case (an
          // auto-capitalised "Https://"), spelled out per letter since the `i`
          // regex modifier isn't Baseline, then no whitespace, so words after
          // the link are refused. `\s*` at both ends: a typed or pasted value
          // is validated untrimmed (only a value set from script is trimmed),
          // and submit trims it anyway.
          pattern="\s*[Hh][Tt][Tt][Pp][Ss]?://\S+\s*"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          {...urlDraft}
          onChange={(e) => {
            // Only ever clears (or keeps accurate) a message already shown.
            if (urlError) setUrlError(urlErrorOf(e.currentTarget))
          }}
          onInvalid={(e) => {
            e.preventDefault()
            setUrlError(urlErrorOf(e.currentTarget))
            e.currentTarget.focus()
          }}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={
            urlError ? 'report-url-hint report-url-error' : 'report-url-hint'
          }
        />
        {urlError && (
          <FieldError id="report-url-error">
            {urlError === 'missing'
              ? '請貼上訊息的網址。'
              : '這裡只能放一個網址，例如 https:// 開頭的連結。'}
            如果是在 LINE 上收到、沒有網址可以附，請改用{' '}
            <a
              href="https://line.me/R/ti/p/%40cofacts"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Cofacts LINE 機器人
            </a>
            回報。
          </FieldError>
        )}
      </Field>

      {/*
        Wording taken verbatim from the LINE bot's ReplyRequestForm
        (rumors-line-bot src/liff/components/ReplyRequestForm.svelte, zh_TW).
        Cofacts has asked this exact question for years; its own copy names who
        reads the answer, which is what makes people write one.
      */}
      <Field>
        <Label htmlFor="report-reason">
          <span>
            為了協助查證，請告訴闢謠志工：
            <br />
            為何您覺得這是謠言？
          </span>
        </Label>
        <Textarea
          id="report-reason"
          name="reason"
          {...reasonDraft}
          placeholder="例：我用 OO 關鍵字查詢 Facebook，發現⋯⋯ / 我在 XX 官網上找到不一樣的說法如下⋯⋯"
        />
      </Field>

      <p className="text-type-caption text-text-secondary">
        送出後這則訊息會公開在 Cofacts
        資料庫，請不要包含姓名、電話、地址、訂單編號等個人資料。
      </p>

      <Button
        type="submit"
        size="lg"
        className="self-center"
        // Never disabled: submitting is what lets validation explain what the
        // field needs, and submitting only navigates — the writes happen on
        // /report/check.
      >
        回報此訊息
      </Button>
    </form>
  )
}
