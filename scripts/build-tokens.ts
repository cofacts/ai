/**
 * Generates the design-token outputs from design/tokens.json (exported from Penpot).
 *
 *   node scripts/build-tokens.ts          # write the outputs
 *   node scripts/build-tokens.ts --check  # exit 1 if any output is out of date (CI)
 *
 * Outputs:
 *   - src/styles/tokens.css            CSS variables (light / dark) + Tailwind @theme
 *   - src/styles/tokens.generated.ts   twMergeTheme for cn(), token lists for Storybook
 *
 * Naming rule: drop the Penpot role prefix to get the class.
 *   surface-raised → bg-raised, text-secondary → text-secondary, border-control → border-control,
 *   icon-muted → text-icon-muted, status-incorrect → text-status-incorrect / bg-status-incorrect,
 *   type-body-m → text-body-m, spacing-16 → p-16 (1 unit = 1px), RADIUS-5 → rounded-5.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'design/tokens.json'
const OUT_CSS = 'src/styles/tokens.css'
const OUT_TS = 'src/styles/tokens.generated.ts'

type Token = { $type: string; $value: unknown }
type TokenSet = Record<string, Token>
type Typography = {
  fontSize: string
  fontWeight: string
  lineHeight: string
}
type Shadow = {
  offsetX: string
  offsetY: string
  blur: string
  spread: string
  color: string
}

const json = JSON.parse(readFileSync(resolve(root, SOURCE), 'utf8')) as {
  Global: TokenSet
  Light: TokenSet
  Dark: TokenSet
}
const { Global, Light, Dark } = json

/** Look up a token, failing loudly on a dangling reference. */
const get = (set: TokenSet, name: string): Token => {
  const token = set[name]
  if (!token) throw new Error(`Unknown token: ${name}`)
  return token
}

const byType = (type: string) =>
  Object.entries(Global).filter(([, t]) => t.$type === type)

const px = (n: number) => `${+(n / 16).toFixed(4)}rem`
const ref = (value: string) => {
  const m = /^\{(.+)\}$/.exec(value)
  return m ? m[1] : null
}
/** `#11182780` → `rgb(17 24 39 / 0.5)`; other values unchanged */
const cssColor = (value: string) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value)
  if (!m) return value
  const [rgb = '', alpha = ''] = m.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16))
  const a = +(parseInt(alpha, 16) / 255).toFixed(2)
  return `rgb(${r} ${g} ${b} / ${a})`
}
const semanticValue = (value: string) => {
  const name = ref(value)
  return name ? `var(--${name})` : cssColor(value)
}
const resolveHex = (value: string): string => {
  const name = ref(value)
  return name ? String(get(Global, name).$value) : value
}

// ---- Semantic colors → Tailwind namespaces -------------------------------------------------

type Utility = { namespace: string; className: string }

/** Which Tailwind utilities a semantic color token becomes. Empty = CSS variable only. */
function utilitiesFor(name: string): Array<Utility> {
  const [prefix, ...rest] = name.split('-')
  const suffix = rest.join('-')
  switch (prefix) {
    case 'surface':
      return [
        {
          namespace: `--background-color-${suffix}`,
          className: `bg-${suffix}`,
        },
      ]
    case 'overlay':
      return [
        {
          namespace: `--background-color-${suffix}`,
          className: `bg-${suffix}`,
        },
      ]
    case 'text':
      return [
        { namespace: `--text-color-${suffix}`, className: `text-${suffix}` },
      ]
    case 'icon':
      return [{ namespace: `--text-color-${name}`, className: `text-${name}` }]
    case 'status':
      return [
        { namespace: `--text-color-${name}`, className: `text-${name}` },
        { namespace: `--background-color-${name}`, className: `bg-${name}` },
      ]
    case 'border':
      // The focus ring colors are used only by the global :focus-visible rule.
      if (suffix === 'focus' || suffix === 'focus-outer') return []
      return [
        {
          namespace: `--border-color-${suffix}`,
          className: `border-${suffix}`,
        },
      ]
    case 'chart':
      // Data colors: read var(--chart-series-N) in chart code, never a UI utility.
      return []
    default:
      throw new Error(`Unknown semantic token prefix: ${name}`)
  }
}

const semanticNames = Object.keys(Light)
for (const name of semanticNames) {
  if (!(name in Dark)) throw new Error(`${name} is in Light but not in Dark`)
}
for (const name of Object.keys(Dark)) {
  if (!(name in Light)) throw new Error(`${name} is in Dark but not in Light`)
}
const isFixed = (name: string) =>
  get(Light, name).$value === get(Dark, name).$value

// ---- Typography ----------------------------------------------------------------------------

const WEIGHTS: Record<string, number> = { regular: 400, bold: 700 }
const typography = byType('typography').map(([name, t]) => {
  const v = t.$value as Typography
  const size = Number(v.fontSize)
  const ratio = Number(v.lineHeight)
  const weight = WEIGHTS[v.fontWeight]
  if (!weight) throw new Error(`${name}: unknown fontWeight ${v.fontWeight}`)
  // ui-* tokens use line-height 1 (single line); others are whole-px heights on a 4px grid.
  const lineHeightPx = ratio === 1 ? null : Math.round(size * ratio)
  return {
    name,
    className: `text-${name.replace(/^type-/, '')}`,
    size,
    weight,
    lineHeight: lineHeightPx === null ? '1' : px(lineHeightPx),
    lineHeightLabel: lineHeightPx === null ? '1' : `${lineHeightPx}px`,
  }
})

const spacing = byType('spacing').map(([name, t]) => ({
  name,
  value: Number(t.$value),
}))
spacing.sort((a, b) => a.value - b.value)

const radius = byType('borderRadius').map(([name, t]) => {
  const value = Number(t.$value)
  const key = value >= 100 ? 'full' : String(value)
  return { name, key, value, className: `rounded-${key}` }
})
radius.sort((a, b) => a.value - b.value)

const shadows = byType('shadow').map(([name, t]) => {
  const key = name.replace(/-shadow$/, '')
  const css = (t.$value as Array<Shadow>)
    .map(
      (s) =>
        `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`,
    )
    .join(', ')
  return { name, key, css, className: `shadow-${key}` }
})

const fontFamily = (byType('fontFamilies')[0]?.[1].$value as Array<string>)[0]

const primitives = byType('color')

// ---- tokens.css ----------------------------------------------------------------------------

const header = `/* ⚙️ Generated from ${SOURCE} by scripts/build-tokens.ts — do not edit. Run \`pnpm tokens\`. */`

/** One line per semantic token: a plain value if it's fixed, otherwise light-dark(light, dark). */
const semanticLine = (name: string) => {
  const light = semanticValue(String(get(Light, name).$value))
  const dark = semanticValue(String(get(Dark, name).$value))
  return isFixed(name)
    ? `  --${name}: ${light};`
    : `  --${name}: light-dark(${light}, ${dark});`
}

const themeLines: Array<string> = []
for (const name of semanticNames) {
  for (const u of utilitiesFor(name))
    themeLines.push(`  ${u.namespace}: var(--${name}); /* ${u.className} */`)
}

const css = `${header}

/* Primitive colors: referenced only by the semantic tokens below. Not registered as utilities (R3). */
:root {
${primitives.map(([n, t]) => `  --${n}: ${String(t.$value)};`).join('\n')}
}

/*
 * Semantic colors. Each token holds both its Light and Dark value; light-dark() picks one from
 * color-scheme, which follows the OS setting (prefers-color-scheme) unless <html data-theme>
 * forces it. Components never pick light or dark themselves.
 */
:root {
  color-scheme: light dark;
${semanticNames.map(semanticLine).join('\n')}
}

[data-theme='light'] {
  color-scheme: light;
}

[data-theme='dark'] {
  color-scheme: dark;
}

@theme {
  /* Only Cofacts tokens exist as utilities. */
  --color-*: initial;
  --text-*: initial;
  --radius-*: initial;
  --shadow-*: initial;
  --font-*: initial;

  /* 1 spacing unit = 1px, so spacing-16 → p-16 and a 343px width → w-343. */
  --spacing: 0.0625rem;

  --font-sans: '${fontFamily}', system-ui, sans-serif;

${themeLines.join('\n')}

${typography
  .map(
    (t) =>
      `  --text-${t.className.slice(5)}: ${px(t.size)}; /* ${t.className}: ${t.size}px / ${t.lineHeightLabel} / ${t.weight} */\n` +
      `  --text-${t.className.slice(5)}--line-height: ${t.lineHeight};\n` +
      `  --text-${t.className.slice(5)}--font-weight: ${t.weight};`,
  )
  .join('\n')}

${radius.map((r) => `  --radius-${r.key}: ${r.key === 'full' ? '9999px' : `${r.value}px`};`).join('\n')}

${shadows.map((s) => `  --shadow-${s.key}: ${s.css};`).join('\n')}
}
`

// ---- tokens.generated.ts -------------------------------------------------------------------

const colorClassSuffixes = [
  ...new Set(
    semanticNames.flatMap((n) =>
      utilitiesFor(n).map((u) => u.className.replace(/^[a-z]+-/, '')),
    ),
  ),
]

const semanticColors = semanticNames.map((name) => ({
  name,
  classes: utilitiesFor(name).map((u) => u.className),
  light: resolveHex(String(get(Light, name).$value)),
  dark: resolveHex(String(get(Dark, name).$value)),
  fixed: isFixed(name),
}))

const ts = `// ⚙️ Generated from ${SOURCE} by scripts/build-tokens.ts — do not edit. Run \`pnpm tokens\`.

/** Custom class names for tailwind-merge, so cn() merges Cofacts utilities correctly. */
export const twMergeTheme = ${JSON.stringify(
  {
    color: colorClassSuffixes,
    text: typography.map((t) => t.className.slice(5)),
    radius: radius.map((r) => r.key),
    shadow: shadows.map((s) => s.key),
  },
  null,
  2,
)}

/** Token lists for the Storybook foundations page. */
export const designTokens = ${JSON.stringify(
  {
    semanticColors,
    typography: typography.map(
      ({ name, className, size, weight, lineHeightLabel }) => ({
        name,
        className,
        size,
        weight,
        lineHeight: lineHeightLabel,
      }),
    ),
    spacing,
    radius,
    shadows,
  },
  null,
  2,
)} as const
`

// ---- write / check -------------------------------------------------------------------------

const outputs: Array<[string, string]> = [
  [OUT_CSS, css],
  [OUT_TS, ts],
]

if (process.argv.includes('--check')) {
  const stale = outputs.filter(([path, content]) => {
    try {
      return readFileSync(resolve(root, path), 'utf8') !== content
    } catch {
      return true
    }
  })
  if (stale.length) {
    console.error(
      `Out of date: ${stale.map(([p]) => p).join(', ')}\nRun \`pnpm tokens\` and commit the result.`,
    )
    process.exit(1)
  }
  console.log('Design token outputs are up to date.')
} else {
  for (const [path, content] of outputs)
    writeFileSync(resolve(root, path), content)
  console.log(`Wrote ${outputs.map(([p]) => p).join(', ')}`)
}
