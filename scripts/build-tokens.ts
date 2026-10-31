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
 * Naming rule: every token keeps its Penpot name; the class is the Tailwind utility + that name.
 *   surface-raised → bg-surface-raised, text-primary → text-text-primary,
 *   border-control → border-border-control (any color utility takes any color token),
 *   type-body-m → text-type-body-m, spacing-16 → p-spacing-16, RADIUS-5 → rounded-radius-5,
 *   btn-shadow → shadow-btn-shadow, noto → font-noto.
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
/** A numeric token value, following `{name}` references into Global. Throws on anything else. */
const num = (token: string, value: unknown): number => {
  const name = typeof value === 'string' ? ref(value) : null
  const n = name ? num(name, get(Global, name).$value) : Number(value)
  if (value === '' || !Number.isFinite(n))
    throw new Error(`${token}: expected a number, got ${JSON.stringify(value)}`)
  return n
}

// ---- Semantic colors → Tailwind namespaces -------------------------------------------------

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
  const size = num(name, v.fontSize)
  const ratio = num(name, v.lineHeight)
  const fontWeight = ref(v.fontWeight)
    ? String(get(Global, ref(v.fontWeight)!).$value)
    : v.fontWeight
  const weight = WEIGHTS[fontWeight]
  if (!weight) throw new Error(`${name}: unknown fontWeight ${fontWeight}`)
  // ui-* tokens use line-height 1 (single line); others are whole-px heights on a 4px grid.
  const lineHeightPx = ratio === 1 ? null : Math.round(size * ratio)
  return {
    name,
    className: `text-${name}`,
    size,
    weight,
    lineHeight: lineHeightPx === null ? '1' : px(lineHeightPx),
    lineHeightLabel: lineHeightPx === null ? '1' : `${lineHeightPx}px`,
  }
})

const spacing = byType('spacing').map(([name, t]) => ({
  name,
  value: num(name, t.$value),
  className: `p-${name}`,
}))
spacing.sort((a, b) => a.value - b.value)

const radius = byType('borderRadius').map(([name, t]) => {
  const value = num(name, t.$value)
  // Tailwind theme keys are lowercase: RADIUS-5 → rounded-radius-5.
  const key = name.toLowerCase()
  return { name, key, value, className: `rounded-${key}` }
})
radius.sort((a, b) => a.value - b.value)

const shadows = byType('shadow').map(([name, t]) => {
  const key = name
  const css = (t.$value as Array<Shadow>)
    .map(
      (s) =>
        `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`,
    )
    .join(', ')
  return { name, key, css, className: `shadow-${key}` }
})

const fonts = byType('fontFamilies').map(([name, t]) => {
  const family = Array.isArray(t.$value) ? t.$value[0] : t.$value
  if (typeof family !== 'string' || !family)
    throw new Error(
      `${name}: expected a font name, got ${JSON.stringify(t.$value)}`,
    )
  return { name, family }
})

const primitives = byType('color')

// ---- tokens.css ----------------------------------------------------------------------------

const header = `/* ⚙️ Generated from ${SOURCE} by scripts/build-tokens.ts — do not edit. Run \`pnpm tokens\`. */`

/**
 * One Tailwind color per semantic token, named exactly like the Penpot token: a plain value if
 * it's fixed, otherwise light-dark(light, dark).
 */
const colorLine = (name: string) => {
  const light = semanticValue(String(get(Light, name).$value))
  const dark = semanticValue(String(get(Dark, name).$value))
  return isFixed(name)
    ? `  --color-${name}: ${light};`
    : `  --color-${name}: light-dark(${light}, ${dark});`
}

/** For browsers without light-dark(): the light or dark value of each token that flips. */
const fallbackLines = (theme: TokenSet, indent: string) =>
  semanticNames
    .filter((name) => !isFixed(name))
    .map(
      (name) =>
        `${indent}--color-${name}: ${semanticValue(String(get(theme, name).$value))};`,
    )
    .join('\n')

const css = `${header}

/* Primitive colors: referenced only by the semantic colors in @theme. Not registered as utilities (R3). */
:root {
${primitives.map(([n, t]) => `  --${n}: ${String(t.$value)};`).join('\n')}
}

/*
 * Each semantic color in @theme holds both its Light and Dark value; light-dark() picks one from
 * color-scheme, which follows the OS setting (prefers-color-scheme) unless <html data-theme>
 * forces it. Components never pick light or dark themselves.
 */
:root {
  color-scheme: light dark;
}

[data-theme='light'] {
  color-scheme: light;
}

[data-theme='dark'] {
  color-scheme: dark;
}

/*
 * Fallback for browsers without light-dark() (Safari / iOS before 17.5, including LINE's in-app
 * browser there): the same values, picked by media query and data-theme instead.
 */
@supports not (color: light-dark(#000, #fff)) {
  :root {
${fallbackLines(Light, '    ')}
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
${fallbackLines(Dark, '      ')}
    }
  }

  [data-theme='dark'] {
${fallbackLines(Dark, '    ')}
  }
}

/* static: emit every variable, including those read only from JS (var(--color-…) in a style prop). */
@theme static {
  /* Only Cofacts tokens exist as utilities. */
  --color-*: initial;
  --text-*: initial;
  --radius-*: initial;
  --shadow-*: initial;

  /*
   * No numeric spacing scale: only spacing tokens (p-spacing-16), 0 (p-0, inset-0) or arbitrary
   * values (w-[343px]).
   */
  --spacing-*: initial;
  --spacing-0: 0px;

${fonts.map((f) => `  --font-${f.name}: '${f.family}', system-ui, sans-serif;`).join('\n')}

${spacing.map((sp) => `  --spacing-${sp.name}: ${px(sp.value)};`).join('\n')}

${semanticNames.map(colorLine).join('\n')}

${typography
  .map(
    (t) =>
      `  --text-${t.className.slice(5)}: ${px(t.size)}; /* ${t.className}: ${t.size}px / ${t.lineHeightLabel} / ${t.weight} */\n` +
      `  --text-${t.className.slice(5)}--line-height: ${t.lineHeight};\n` +
      `  --text-${t.className.slice(5)}--font-weight: ${t.weight};`,
  )
  .join('\n')}

${radius.map((r) => `  --radius-${r.key}: ${r.value}px;`).join('\n')}

${shadows.map((s) => `  --shadow-${s.key}: ${s.css};`).join('\n')}
}
`

// ---- tokens.generated.ts -------------------------------------------------------------------

const semanticColors = semanticNames.map((name) => ({
  name,
  light: resolveHex(String(get(Light, name).$value)),
  dark: resolveHex(String(get(Dark, name).$value)),
  fixed: isFixed(name),
}))

const ts = `// ⚙️ Generated from ${SOURCE} by scripts/build-tokens.ts — do not edit. Run \`pnpm tokens\`.

/** Custom theme values for tailwind-merge, so cn() merges Cofacts utilities correctly. */
export const twMergeTheme = ${JSON.stringify(
  {
    text: typography.map((t) => t.className.slice(5)),
    radius: radius.map((r) => r.key),
    spacing: spacing.map((sp) => sp.name),
    font: fonts.map((f) => f.name),
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
