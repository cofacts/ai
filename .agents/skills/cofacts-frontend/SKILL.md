---
name: cofacts-frontend
description: >
  Cofacts frontend work in this repo — any change to src/**/*.tsx, src/**/*.css, *.stories.tsx,
  design tokens (design/tokens.json, src/styles/), route data loading, or implementing a screen from
  the Penpot file "Cofacts-2026". Use it whenever building or restyling UI, porting a rumors-site
  page, adding a route or server function, or reviewing a UI PR, so the result matches Penpot, the
  Cofacts accessibility guide, and the data-layer rules.
---

# Cofacts frontend

The design system comes from the Penpot file **Cofacts-2026** (tokens, components, page boards)
and the designer's **Cofacts 無障礙與前端實作指南** (accessibility guide). The full design
rationale is in the kb doc
[Phase 3 網站遷移與前端架構](https://github.com/cofacts/kb/blob/main/src/technical-design/cofacts.ai/Phase%203%20網站遷移與前端架構.md);
this skill is the current, executable form of it.

## References (read the one you need)

| File                                                       | Read it when                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [references/mapping-rules.md](references/mapping-rules.md) | Turning Penpot data (MCP) into Tailwind classes and component props.      |
| [references/penpot-mcp.md](references/penpot-mcp.md)       | Using the Penpot MCP: auditing a board, exporting tokens, known pitfalls. |
| [references/a11y.md](references/a11y.md)                   | Any UI work. Rules R1–R5, focus, interaction specs per component.         |
| [references/structure.md](references/structure.md)         | Deciding where a file goes; component layers; styling rules.              |
| [references/data-layer.md](references/data-layer.md)       | Loading or writing data: server functions, TanStack Query, loaders.       |

## Hard rules

- **Tokens only.** Class = Penpot token name without its role prefix (`surface-raised` →
  `bg-raised`, `type-body-m` → `text-body-m`); the full list with each class is in the generated
  `src/styles/tokens.css` (comments name the class), and Storybook's Foundations/Tokens shows them. No arbitrary colors (`[#…]`,
  `style={{ color }}`), no primitive colors (`neutral-900`), no `dark:` variants (tokens flip by
  themselves), no bare font sizes (`text-16`) or `leading-*` / `font-semibold` — use a typography
  class (`text-body-m`, `text-ui-s-bold`…). Spacing is 1px per unit: `p-16` is 16px.
- **Brand yellow is a background, never text** (R2). `bg-accent` pairs with `text-on-accent`.
- **Pair by name** (R4): `bg-dark` → `text-on-dark`, `bg-secondary` → `text-on-secondary`,
  `bg-inverse` → `text-inverse`. A name that doesn't match is a bug.
- **Status colors** (`text-status-*`, `bg-status-*`, `border-status-*`) only in
  `ReplyTypeLabel` / `StatusIcon`, `VerdictPicker` and status badges, always with text and a shape
  icon (R1). Exception: errors and destructive actions use `status-incorrect` (Input Invalid,
  FieldError, delete buttons), always with text.
- **Disabled = default look + `opacity-50`**, plus `disabled` or `aria-disabled="true"` (R5).
- **Focus is global.** Never add `focus-visible:ring-*` or per-component focus styles. Put
  `data-surface="dark"` on fixed-dark containers.
- **Merge classes with `cn()`** (`@/lib/utils`), which knows the token names. Variants use cva.
- **Components don't fetch data.** Shared components and `-components/` take typed props; only
  route components call query hooks. See `references/data-layer.md`.
- **No GraphQL in the browser.** `createServerFn` handlers call `cofactsExec`; `*.server` imports
  only inside handlers; loaders only call server functions. Treat an import-protection warning
  in dev as an error.

## Workflow

1. **Intake.** Find the Penpot board (name or id). Audit it with the snippet in
   `references/penpot-mcp.md`: component instances, token bindings, unbound values, R4 pairs,
   the board's 開發 Note. Report the plan and any design questions before coding.
2. **Reuse.** Check `src/components/` and its stories first. Missing ui/shared components are
   built first, each with a story. A component used by one route goes in that route's
   `-components/`; move it to `src/components/` when a second place needs it.
3. **Build.** Map Penpot to classes with `references/mapping-rules.md`. Data per
   `references/data-layer.md`.
4. **Stories.** One story per Penpot state board. Pages render a pure `XxxPageView` with
   fixtures; callbacks use `fn()`.
5. **Verify** (all required):
   - `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm tokens:check`, `pnpm build`
   - Storybook at 375 and 1440, in light **and** dark, compared with Penpot `export_shape`
   - keyboard walk-through; the checklist in `references/a11y.md`
6. **PR.** Include the Penpot link, Storybook link, deviations from Penpot, the list of unbound
   values for the designer, and the a11y checklist.

## Changing tokens

Tokens are owned by the designer in Penpot. To update: export with the snippet in
`references/penpot-mcp.md` into `design/tokens.json`, run `pnpm tokens`, commit all outputs.
CI runs `pnpm tokens:check`.
