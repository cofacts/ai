import tokens from '../../design/tokens.json'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

/**
 * The design tokens from Penpot "Cofacts-2026" (design/tokens.json), drawn with the CSS variables
 * the app uses. Switch the Theme in the toolbar to check that colors flip between light and dark.
 */
const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

type Token = { $type: string; $value: unknown }
const global = Object.entries(tokens.Global as Record<string, Token>)
const byType = (type: string) => global.filter(([, t]) => t.$type === type)
const light = tokens.Light as Record<string, Token>
const dark = tokens.Dark as Record<string, Token>

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
            {Object.keys(light)
              .filter((name) => name.startsWith(`${group}-`))
              .map((name) => (
                <div key={name} className="flex items-center gap-spacing-12">
                  <div
                    className="size-spacing-48 shrink-0 rounded-radius-5 border border-border-subtle"
                    style={{ background: `var(--color-${name})` }}
                  />
                  <div className="flex min-w-0 flex-col gap-spacing-4">
                    <code className="text-type-ui-s-bold">{name}</code>
                    <span className="text-type-caption text-text-tertiary">
                      {String(light[name]?.$value)} /{' '}
                      {String(dark[name]?.$value)}
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
      {byType('typography').map(([name, t]) => {
        const v = t.$value as Record<string, string>
        return (
          <div
            key={name}
            className="flex flex-col gap-spacing-4 border-b border-border-subtle pb-spacing-16"
          >
            <span className="text-type-caption text-text-tertiary">
              text-{name} · {v.fontSize}px / {v.lineHeight} / {v.fontWeight}
            </span>
            <p
              style={{
                fontSize: `var(--text-${name})`,
                lineHeight: `var(--text-${name}--line-height)`,
                fontWeight: `var(--text-${name}--font-weight)`,
              }}
            >
              Cofacts 真的假的：網路謠言、詐騙訊息，讓大家一起查核。The quick
              brown fox.
            </p>
          </div>
        )
      })}
    </div>
  ),
}

export const Spacing: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-8">
      {byType('spacing').map(([name]) => (
        <div key={name} className="flex items-center gap-spacing-16">
          <code className="w-spacing-120 text-type-ui-s">p-{name}</code>
          <div
            className="h-spacing-16 bg-surface-accent"
            style={{ width: `var(--spacing-${name})` }}
          />
        </div>
      ))}
    </div>
  ),
}

export const RadiusAndShadow: Story = {
  render: () => (
    <div className="flex flex-wrap gap-spacing-24">
      {byType('borderRadius').map(([name]) => (
        <div key={name} className="flex flex-col items-center gap-spacing-8">
          <div
            className="size-spacing-64 border border-border-control bg-surface-raised"
            style={{ borderRadius: `var(--radius-${name.toLowerCase()})` }}
          />
          <code className="text-type-caption">
            rounded-{name.toLowerCase()}
          </code>
        </div>
      ))}
      {byType('shadow').map(([name]) => (
        <div key={name} className="flex flex-col items-center gap-spacing-8">
          <div
            className="size-spacing-64 rounded-radius-5 bg-surface-base"
            style={{ boxShadow: `var(--shadow-${name})` }}
          />
          <code className="text-type-caption">shadow-{name}</code>
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
        <button className="rounded-radius-100 border border-border-control px-spacing-16 py-spacing-8 text-type-ui-m">
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
