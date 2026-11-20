// resvg (SVG → PNG) as WebAssembly, for /article/:id/og.png. The native
// @resvg/resvg-js can't be bundled into .output (a .node addon, per platform);
// the wasm build ships inside the server bundle like the fonts (`?base64`), and
// is only loaded on the first card.

import { Resvg, initWasm } from '@resvg/resvg-wasm'
import wasm from '@resvg/resvg-wasm/index_bg.wasm?base64'

let ready: Promise<void> | undefined

export async function svgToPng(svg: string) {
  ready ??= initWasm(Buffer.from(wasm.slice(wasm.indexOf(',') + 1), 'base64'))
  await ready
  // Every glyph is already a path in satori's SVG, so resvg needs no fonts.
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()
}
