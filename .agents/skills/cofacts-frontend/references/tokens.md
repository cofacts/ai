<!-- ⚙️ Generated from design/tokens.json by scripts/build-tokens.ts — do not edit. Run `pnpm tokens`. -->

# Design tokens → Tailwind classes

Source: Penpot file **Cofacts-2026**, exported to `design/tokens.json`. Rule: drop the role prefix.
Fixed = same value in light and dark (use on fixed backgrounds such as `bg-dark`, see R4 in a11y.md).

## Semantic colors (51)

| Penpot token | Class | Light | Dark | Fixed |
| --- | --- | --- | --- | --- |
| `text-primary` | `text-primary` | #111827 | #f3f4f6 |  |
| `text-secondary` | `text-secondary` | #374151 | #d1d5db |  |
| `text-tertiary` | `text-tertiary` | #6b7280 | #9ca3af |  |
| `text-disabled` | `text-disabled` | #9ca3af | #4b5563 |  |
| `text-inverse` | `text-inverse` | #ffffff | #111827 |  |
| `text-link` | `text-link` | #1673d1 | #42a0ff |  |
| `text-on-accent` | `text-on-accent` | #111827 | #111827 | yes |
| `text-on-secondary` | `text-on-secondary` | #ffffff | #f3f4f6 |  |
| `text-on-status` | `text-on-status` | #ffffff | #111827 |  |
| `text-on-dark` | `text-on-dark` | #f3f4f6 | #f3f4f6 | yes |
| `text-on-dark-muted` | `text-on-dark-muted` | #9ca3af | #9ca3af | yes |
| `text-on-info` | `text-on-info` | #111827 | #111827 | yes |
| `text-on-line` | `text-on-line` | #ffffff | #ffffff | yes |
| `surface-base` | `bg-base` | #ffffff | #111827 |  |
| `surface-raised` | `bg-raised` | #f3f4f6 | #1f2937 |  |
| `surface-selected` | `bg-selected` | #e5e7eb | #374151 |  |
| `surface-inverse` | `bg-inverse` | #1f2937 | #f3f4f6 |  |
| `surface-secondary` | `bg-secondary` | #1f2937 | #374151 |  |
| `surface-accent` | `bg-accent` | #ffb600 | #ffb600 | yes |
| `surface-accent-subtle` | `bg-accent-subtle` | #ffeaba | #e9a802 |  |
| `surface-accent-fold` | `bg-accent-fold` | #ff9200 | #ff9200 | yes |
| `surface-dark` | `bg-dark` | #111827 | #111827 | yes |
| `surface-dark-raised` | `bg-dark-raised` | #1f2937 | #1f2937 | yes |
| `surface-on-dark` | `bg-on-dark` | #ffffff | #ffffff | yes |
| `surface-info` | `bg-info` | #1789fc | #1789fc | yes |
| `surface-info-strong` | `bg-info-strong` | #1673d1 | #1673d1 | yes |
| `surface-line` | `bg-line` | #06c755 | #06c755 | yes |
| `border-subtle` | `border-subtle` | #d1d5db | #374151 |  |
| `border-control` | `border-control` | #6b7280 | #9ca3af |  |
| `border-strong` | `border-strong` | #111827 | #f3f4f6 |  |
| `border-accent` | `border-accent` | #ffb600 | #ffb600 | yes |
| `border-inverse` | `border-inverse` | #ffffff | #111827 |  |
| `border-focus` | `var(--border-focus)` only | #111827 | #f3f4f6 |  |
| `border-focus-outer` | `var(--border-focus-outer)` only | #ffb600 | #ffb600 | yes |
| `border-on-dark` | `border-on-dark` | #374151 | #374151 | yes |
| `border-on-dark-strong` | `border-on-dark-strong` | #f3f4f6 | #f3f4f6 | yes |
| `icon-default` | `text-icon-default` | #111827 | #f3f4f6 |  |
| `icon-muted` | `text-icon-muted` | #6b7280 | #9ca3af |  |
| `icon-inverse` | `text-icon-inverse` | #ffffff | #111827 |  |
| `icon-brand` | `text-icon-brand` | #ffb600 | #ffb600 | yes |
| `icon-on-accent` | `text-icon-on-accent` | #111827 | #111827 | yes |
| `icon-on-secondary` | `text-icon-on-secondary` | #ffffff | #f3f4f6 |  |
| `icon-on-dark` | `text-icon-on-dark` | #f3f4f6 | #f3f4f6 | yes |
| `icon-on-line` | `text-icon-on-line` | #ffffff | #ffffff | yes |
| `status-incorrect` | `text-status-incorrect` `bg-status-incorrect` | #df3324 | #ff8a81 |  |
| `status-correct` | `text-status-correct` `bg-status-correct` | #06865b | #39dea6 |  |
| `status-opinion` | `text-status-opinion` `bg-status-opinion` | #1673d1 | #42a0ff |  |
| `status-outofscope` | `text-status-outofscope` `bg-status-outofscope` | #7c45d6 | #aa80ee |  |
| `chart-series-1` | `var(--chart-series-1)` only | #ffb600 | #ffb600 | yes |
| `chart-series-2` | `var(--chart-series-2)` only | #1789fc | #1789fc | yes |
| `overlay-scrim` | `bg-scrim` | #11182780 | #11182780 | yes |

Primitive colors (`neutral-900`, `brand-500-main`…) have no utilities. Never use them in components.

## Typography (17)

| Penpot token | Class | Size | Line height | Weight |
| --- | --- | --- | --- | --- |
| `type-ui-l` | `text-ui-l` | 18px | 1 | 400 |
| `type-ui-l-bold` | `text-ui-l-bold` | 18px | 1 | 700 |
| `type-ui-m` | `text-ui-m` | 16px | 1 | 400 |
| `type-ui-m-bold` | `text-ui-m-bold` | 16px | 1 | 700 |
| `type-ui-s` | `text-ui-s` | 14px | 1 | 400 |
| `type-ui-s-bold` | `text-ui-s-bold` | 14px | 1 | 700 |
| `type-ui-xs` | `text-ui-xs` | 12px | 1 | 400 |
| `type-ui-xs-bold` | `text-ui-xs-bold` | 12px | 1 | 700 |
| `type-body-l` | `text-body-l` | 18px | 32px | 400 |
| `type-body-m` | `text-body-m` | 16px | 28px | 400 |
| `type-body-s` | `text-body-s` | 14px | 24px | 400 |
| `type-caption` | `text-caption` | 12px | 20px | 400 |
| `type-heading-xl` | `text-heading-xl` | 36px | 44px | 700 |
| `type-heading-l` | `text-heading-l` | 28px | 36px | 700 |
| `type-heading-m` | `text-heading-m` | 24px | 32px | 700 |
| `type-heading-s` | `text-heading-s` | 18px | 24px | 700 |
| `type-heading-xs` | `text-heading-xs` | 16px | 24px | 700 |

There are no bare font-size classes (`text-16` does not exist). `ui` tokens are for single-line text only.

## Spacing (1 unit = 1px)

`spacing-2` → `p-2` / `gap-2` / `m-2`  
`spacing-4` → `p-4` / `gap-4` / `m-4`  
`spacing-8` → `p-8` / `gap-8` / `m-8`  
`spacing-12` → `p-12` / `gap-12` / `m-12`  
`spacing-16` → `p-16` / `gap-16` / `m-16`  
`spacing-20` → `p-20` / `gap-20` / `m-20`  
`spacing-24` → `p-24` / `gap-24` / `m-24`  
`spacing-32` → `p-32` / `gap-32` / `m-32`  
`spacing-48` → `p-48` / `gap-48` / `m-48`  
`spacing-64` → `p-64` / `gap-64` / `m-64`  
`spacing-120` → `p-120` / `gap-120` / `m-120`

## Radius, shadow

`RADIUS-2` → `rounded-2`  
`RADIUS-5` → `rounded-5`  
`RADIUS-10` → `rounded-10`  
`RADIUS-100` → `rounded-full`
`btn-shadow` → `shadow-btn`
