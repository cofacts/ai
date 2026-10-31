import { designTokens } from './tokens.generated'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

/**
 * The design tokens from Penpot "Cofacts-2026", as the app sees them. Switch the Theme in the
 * toolbar to check that tokens flip (or stay fixed) between light and dark.
 */
const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const groups = [
  'text',
  'surface',
  'overlay',
  'border',
  'icon',
  'status',
  'chart',
] as const

export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-32">
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-spacing-12">
          <h2 className="text-type-heading-s">{group}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-spacing-12">
            {designTokens.semanticColors
              .filter((c) => c.name.startsWith(`${group}-`))
              .map((c) => (
                <div key={c.name} className="flex items-center gap-spacing-12">
                  <div
                    className="size-spacing-48 shrink-0 rounded-radius-5 border border-border-subtle"
                    // Swatch reads the live CSS variable, so it follows the Theme toolbar.
                    style={{ background: `var(--${c.name})` }}
                  />
                  <div className="flex min-w-0 flex-col gap-spacing-4">
                    <code className="text-type-ui-s-bold">{c.name}</code>
                    <span className="text-type-caption text-text-secondary">
                      {c.classes.join(' ') || `var(--${c.name})`}
                    </span>
                    <span className="text-type-caption text-text-tertiary">
                      {c.fixed
                        ? `${c.light} (fixed)`
                        : `${c.light} / ${c.dark}`}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  ),
}

export const Typography: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-24">
      {designTokens.typography.map((t) => (
        <div
          key={t.name}
          className="flex flex-col gap-spacing-4 border-b border-border-subtle pb-spacing-16"
        >
          <span className="text-type-caption text-text-tertiary">
            {t.className} · {t.size}px / {t.lineHeight} / {t.weight}
          </span>
          <p className={t.className}>
            Cofacts 真的假的：網路謠言、詐騙訊息，讓大家一起查核。The quick
            brown fox.
          </p>
        </div>
      ))}
    </div>
  ),
}

export const Spacing: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-8">
      {designTokens.spacing.map((s) => (
        <div key={s.name} className="flex items-center gap-spacing-16">
          <code className="w-spacing-120 text-type-ui-s">{s.name}</code>
          <div
            className="h-spacing-16 bg-surface-accent"
            style={{ width: `${s.value}px` }}
          />
          <span className="text-type-caption text-text-tertiary">
            p-{s.value}
          </span>
        </div>
      ))}
    </div>
  ),
}

export const RadiusAndShadow: Story = {
  render: () => (
    <div className="flex flex-wrap gap-spacing-24">
      {designTokens.radius.map((r) => (
        <div key={r.name} className="flex flex-col items-center gap-spacing-8">
          <div
            className={`size-spacing-64 border border-border-control bg-surface-raised ${r.className}`}
          />
          <code className="text-type-caption">{r.className}</code>
        </div>
      ))}
      {designTokens.shadows.map((s) => (
        <div key={s.name} className="flex flex-col items-center gap-spacing-8">
          <div
            className={`size-spacing-64 rounded-radius-5 bg-surface-base ${s.className}`}
          />
          <code className="text-type-caption">{s.className}</code>
        </div>
      ))}
    </div>
  ),
}

export const FocusRing: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-24">
      <p className="text-type-body-s text-text-secondary">
        Press Tab to move focus.
      </p>
      <div className="flex gap-spacing-24">
        <button className="rounded-radius-5 bg-surface-accent px-spacing-16 py-spacing-8 text-type-ui-m-bold text-text-on-accent">
          Primary
        </button>
        <button className="rounded-full border border-border-control px-spacing-16 py-spacing-8 text-type-ui-m">
          Outline
        </button>
        <button className="rounded-radius-5 bg-surface-accent px-spacing-16 py-spacing-8 text-type-ui-m-bold text-text-on-accent shadow-btn-shadow">
          With shadow-btn-shadow
        </button>
      </div>
      <div
        data-surface="dark"
        className="flex gap-spacing-24 bg-surface-dark p-spacing-24"
      >
        <button className="rounded-radius-5 bg-surface-on-dark px-spacing-16 py-spacing-8 text-type-ui-m-bold text-text-on-accent">
          On dark
        </button>
        <a href="#focus" className="text-type-ui-m text-text-on-dark underline">
          Link on dark
        </a>
      </div>
    </div>
  ),
}
