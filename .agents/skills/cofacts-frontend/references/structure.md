# Structure and styling

## Component layers

| Layer  | Where                               | What                                                                                                                                                                    |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tokens | `src/styles/tokens.css` (generated) | CSS variables + Tailwind `@theme`                                                                                                                                       |
| icons  | `src/components/icons/`             | `MaterialIcon`, `BrandIcon`, `StatusIcon` (Penpot Base/Icon); used by ui and shared components                                                                          |
| ui     | `src/components/ui/`                | shadcn / Base UI primitives (Button, Input, Select, Dialog, Tabs…), rewritten to Cofacts tokens                                                                         |
| shared | `src/components/` (flat)            | Components used in two or more places: composites built from ui (`ReplyTypeLabel`, `FactCheckReply`, `ArticleCard`) and repeated large pieces (`SiteNav`, `SiteFooter`) |
| page   | `src/routes/`                       | Route components, plus components only that route uses in its `-components/` folder                                                                                     |

**`-components/`:** TanStack Router ignores files and folders starting with `-`, so
`routes/article.$id/-components/Transcript.tsx` doesn't become a route. Put page-only
components there (never as loose `-Foo.tsx` files), so everything else under `routes/` is a route.
A `-components/` folder serves the routes in its directory. **Never import another directory's
`-components/`.** When a second place needs a component, move it to `src/components/` and give it
a story and `parameters.penpot`.

**Site shell:** `__root.tsx` renders the global nav and footer around every page; routes sit
directly under `routes/` (no `_site` layout). Pages scroll the document (keep it that way: scroll
restoration, `#anchors`, printing and the mobile URL bar depend on it). A route that draws its own
nav or footer, or wants none, sets `staticData: { hideGlobalNav: true }` / `{ hideGlobalFooter: true }`.
A screen that scrolls inside its own panels (the AI chat) sets `{ fillViewport: true }` to be pinned
to the viewport height; this doesn't hide the footer, so set `hideGlobalFooter` too when a footer
couldn't be reached. A flag on a parent route covers its children. Pages that only need to share `-components/` can use
a route group folder such as `(lists)/`, which doesn't change the URL.

Colocate per component: `Foo.tsx`, `Foo.stories.tsx`, `Foo.module.css` (only when needed),
`Foo.test.tsx` (when it has logic).

## Styling

- Tailwind with Cofacts tokens. CSS Modules only where Tailwind can't express it: complex
  keyframes, `::before` decoration, scroll-driven animation, third-party DOM. **No CSS-in-JS.**
- `src/styles/global.css` holds only truly global rules (Tailwind import, tokens, body base,
  focus ring). Component styles never go there.
- Variants with `class-variance-authority` (cva). Penpot's named variant properties map 1:1 to
  cva `variants`.
- Merge classes with `cn()` from `@/lib/utils`. It is configured with the token names
  (`twMergeTheme`); a plain `twMerge` would drop `text-type-body-m` when merged with `text-text-primary`.
- Props: plain TypeScript types describing the fields a component needs. No GraphQL fragments.
  When a component should reuse a query's type, take a subtype of the codegen result type.
- One responsive component replaces Penpot's desktop / `-Mobile` pairs.
- Icons live in `src/components/icons/`, as three components (all `aria-hidden`, colored by
  `currentColor`):
  - `MaterialIcon`: a Material Symbol (Rounded, the designer's settings) by name, `filled` for
    the solid version. The font request only has the names in
    `src/components/icons/material-symbols.ts`: **to use a new icon, add its name there**
    (the type check fails otherwise). Loading every icon instead would be about 550 KB, not 9 KB.
  - `BrandIcon`: brand marks that aren't Material Symbols (`facebook`, `line`), as SVG paths.
  - `StatusIcon`: the four fact-check result shapes.

  The `components/Icons` Penpot story lists every icon on Penpot's Base/Icon with the code for it.

- Animations respect `prefers-reduced-motion`.

## Themes

Light / dark follow `prefers-color-scheme`. `<html data-theme="light|dark">` overrides it (used
by Storybook's Theme toolbar, and by a future toggle). Components never branch on theme.
