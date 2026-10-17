# Penpot MCP recipes

File: **Cofacts-2026** (the date in the file name changes with each delivery). Read the
Penpot MCP `high_level_overview` once before using `execute_code`.

## Pitfalls

1. **A set's `resolvedValue` uses the currently active theme.** Read `value` (e.g. `{neutral-100}`)
   and resolve it against the `Global` set yourself.
2. **Never rely on, or change, the active theme or set checkboxes.** Themes:
   `Color scheme / Light` = Global + Light, `Color scheme / Dark` = Global + Dark. The designer
   switches them; the state is saved in the file, so changing it from MCP changes their screen.
   `export_shape` renders the current theme — check which one before comparing screenshots.
3. **`generateStyle()` loses token names** (raw hex, absolute positions). Use `shape.tokens`.
4. Gradients can't bind tokens (original-message fade, Button AI border). Rebuild them with
   tokens in code.
5. The plugin pauses when its browser tab is in the background ("no heartbeat"). Keep the Penpot
   tab in front while working.
6. `generateStyle` wraps text in a `font-size: 0` span. Don't copy it.

## Export tokens → `design/tokens.json`

Run in `execute_code`, save the returned JSON (pretty-printed) as `design/tokens.json`, then
`pnpm tokens`. Keep the top-level `$description` line.

```js
const out = {}
for (const set of penpot.library.local.tokens.sets) {
  out[set.name] = {}
  for (const t of set.tokens) {
    const v = t.value
    if (t.type === 'shadow') v.forEach((s) => delete s.colorResult)
    out[set.name][t.name] = { $type: t.type, $value: v }
  }
}
return JSON.stringify(out)
```

## Audit a board

Returns component instances, token bindings and unbound values for one board.

```js
const board = penpotUtils.findShape((s) => s.name === 'BOARD NAME')
const report = {
  components: {},
  unboundFills: [],
  unboundText: [],
  textTokens: {},
}
const walk = (s) => {
  if (s.isComponentInstance?.()) {
    const c = s.component()
    const key = `${c.path}/${c.name}`
    report.components[key] = (report.components[key] || 0) + 1
    return // don't descend into instances
  }
  const tk = s.tokens || {}
  if (s.type === 'text') {
    if (!tk.typography) report.unboundText.push(s.name)
    else
      report.textTokens[tk.typography] =
        (report.textTokens[tk.typography] || 0) + 1
  }
  if (s.fills?.length && !tk.fill)
    report.unboundFills.push(`${s.name}: ${s.fills[0].fillColor}`)
  s.children?.forEach(walk)
}
walk(board)
return report
```

Also read the board's sibling 備註 board for 開發 Note.
