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
    <div className="flex flex-col gap-32">
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-12">
          <h2 className="text-heading-s">{group}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12">
            {designTokens.semanticColors
              .filter((c) => c.name.startsWith(`${group}-`))
              .map((c) => (
                <div key={c.name} className="flex items-center gap-12">
                  <div
                    className="size-48 shrink-0 rounded-5 border border-border-subtle"
                    // Swatch reads the live CSS variable, so it follows the Theme toolbar.
                    style={{ background: `var(--${c.name})` }}
                  />
                  <div className="flex min-w-0 flex-col gap-4">
                    <code className="text-ui-s-bold">{c.name}</code>
                    <span className="text-caption text-text-secondary">
                      {c.classes.join(' ') || `var(--${c.name})`}
                    </span>
                    <span className="text-caption text-text-tertiary">
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
    <div className="flex flex-col gap-24">
      {designTokens.typography.map((t) => (
        <div
          key={t.name}
          className="flex flex-col gap-4 border-b border-border-subtle pb-16"
        >
          <span className="text-caption text-text-tertiary">
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
    <div className="flex flex-col gap-8">
      {designTokens.spacing.map((s) => (
        <div key={s.name} className="flex items-center gap-16">
          <code className="w-120 text-ui-s">{s.name}</code>
          <div
            className="h-16 bg-surface-accent"
            style={{ width: `${s.value}px` }}
          />
          <span className="text-caption text-text-tertiary">p-{s.value}</span>
        </div>
      ))}
    </div>
  ),
}

export const RadiusAndShadow: Story = {
  render: () => (
    <div className="flex flex-wrap gap-24">
      {designTokens.radius.map((r) => (
        <div key={r.name} className="flex flex-col items-center gap-8">
          <div
            className={`size-64 border border-border-control bg-surface-raised ${r.className}`}
          />
          <code className="text-caption">{r.className}</code>
        </div>
      ))}
      {designTokens.shadows.map((s) => (
        <div key={s.name} className="flex flex-col items-center gap-8">
          <div className={`size-64 rounded-5 bg-surface-base ${s.className}`} />
          <code className="text-caption">{s.className}</code>
        </div>
      ))}
    </div>
  ),
}

export const FocusRing: Story = {
  render: () => (
    <div className="flex flex-col gap-24">
      <p className="text-body-s text-text-secondary">
        Press Tab to move focus.
      </p>
      <div className="flex gap-24">
        <button className="rounded-5 bg-surface-accent px-16 py-8 text-ui-m-bold text-text-on-accent">
          Primary
        </button>
        <button className="rounded-full border border-border-control px-16 py-8 text-ui-m">
          Outline
        </button>
        <button className="rounded-5 bg-surface-accent px-16 py-8 text-ui-m-bold text-text-on-accent shadow-btn">
          With shadow-btn
        </button>
      </div>
      <div data-surface="dark" className="flex gap-24 bg-surface-dark p-24">
        <button className="rounded-5 bg-surface-on-dark px-16 py-8 text-ui-m-bold text-text-on-accent">
          On dark
        </button>
        <a href="#focus" className="text-ui-m text-text-on-dark underline">
          Link on dark
        </a>
      </div>
    </div>
  ),
}
