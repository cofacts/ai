# Penpot → Tailwind mapping rules

Apply in this order.

## 1. Component instances first

If `shape.isComponentInstance()`, look up `shape.component()` (path/name) among
`src/components/` stories (`parameters.penpot`) and use that component. Variant properties become
props, values in kebab-case: Button `Size: Icon-Touch` → `size="icon-touch"`,
`Style: OnDark` → `variant="on-dark"`. `Device: Desktop/Mobile` and `-Mobile` component pairs are
**one responsive component**, not a prop. Never re-implement a component's internals in a page.

No match: decide whether it should be a new shared component instead of page code.

## 2. Bound tokens: read `shape.tokens`

| `shape.tokens` property        | Shape             | Class                                                                       |
| ------------------------------ | ----------------- | --------------------------------------------------------------------------- |
| `fill`                         | board / rect      | `bg-{token}`: `bg-surface-raised`, `bg-overlay-scrim`                       |
| `fill`                         | text              | `text-{token}`: `text-text-primary`, or `text-status-*`                     |
| `fill`                         | path / svg (icon) | `text-icon-*` (icons use `currentColor`)                                    |
| `strokeColor`                  | any               | `border-{token}`: `border-border-control`                                   |
| `strokeWidth`                  | any               | `border` (1), `border-2`, `border-3`, `border-4`, `border-[0.5px]`          |
| `paddingTop/Right/Bottom/Left` | flex/grid board   | `pt-{token}`: `pt-spacing-16`; merge equal sides into `p-` / `px-` / `py-`  |
| `rowGap` / `columnGap`         | flex board        | `gap-{token}` along the main axis; grid: `gap-x-` / `gap-y-`                |
| `borderRadius*`                | any               | `rounded-{token, lowercase}`: `rounded-radius-5`; per corner `rounded-tl-`… |
| `typography`                   | text              | `text-{token}`: `text-type-body-m` — gives size, line height and weight     |
| `shadow`                       | any               | `shadow-btn-shadow`                                                         |

Never read a text shape's `fontSize`, `lineHeight` or `fontWeight` directly; the typography
token is the source. Weights are only 400 and 700.

## 3. Unbound values

- **Color:** hex → primitive → the semantic token of the right role that points to it in the
  current theme (text → `text-text-*`). Use it only if it's the **only** candidate, and list it in the
  PR's "unbound values" for the designer. Zero or several candidates: stop and ask. Never write
  `bg-[#xxxxxx]`.
- **Spacing:** use the token if equal; otherwise round to the nearest step
  (2/4/8/12/16/20/24/32/48/64/120) and list it. Page widths (e.g. 200px side margins on a 1440
  board) are not spacing: use the content max width (1040, centered).
- **Text without a typography token:** pick from heading / body / ui by size, weight and whether
  it wraps; list it.

## 4. Layout

- Flex board → `flex` + `flex-row`/`flex-col`; `justifyContent`/`alignItems` → `justify-*`/`items-*`.
- `layoutChild.horizontalSizing`: `fill` → `flex-1` or `w-full`; `auto` → no width (hug);
  `fix` → `w-N` only for truly fixed things (icons, avatars).
- The outer 1440 / 375 board is the viewport, not a container width.
- Ignore `generateStyle()` positions (`position:absolute; left/top`) and raw hex values.

## 5. Desktop / mobile

Pair `-1440` / `-Mobile` boards and `X` / `X-Mobile` components into one responsive component.
Mobile-first: mobile values are the base classes, desktop values get the breakpoint prefix (`md:`
until the designer defines breakpoints; content max width 1040 centered).

## 6. Text, icons, notes

- `characters` is placeholder copy; real text comes from data or existing copy (lingui).
- `Base/Icon` `Name` value → `<MaterialIcon name>` with the Material Symbol name, snake_case
  (`Open-In-New` → `open_in_new`); add a name that isn't in `material-symbols.ts` there first. The
  exceptions are in the `icons/Icons` Penpot story: `rss` → `rss_feed`, `plus` → `add`, `flag` →
  `flag_2` filled, `report` → `flag_check` filled, `Bookmark-fill` → `bookmark` filled, and Build /
  Thumb Up / Thumb Down are `filled`; `fb` / `line` are `BrandIcon`, `status-*` are `StatusIcon`.
- State boards (`A-…`, `B-1-…`, `…-未登入`) each become a story.
- Boards named 備註: "開發 Note" is a requirement (implement it or explain in the PR);
  "頁面層級標記" names the page/route. Never render them as UI.
