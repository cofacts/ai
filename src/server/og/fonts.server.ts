// Noto Sans TC (SIL OFL 1.1, see ./fonts/OFL.txt) for /article/:id/og.png.
//
// `?base64` (base64Import in vite.config.ts) puts each font into the server bundle,
// so it ships inside .output/ with no Nitro asset config and no download at runtime.
// The whole font is used, not a subset: a reported message can hold any
// character. Only og.png imports this module, and it does so with import(), so
// the ~14 MB of fonts are loaded on the first card, not with every page.

import bold from './fonts/NotoSansTC-Bold.ttf?base64'
import regular from './fonts/NotoSansTC-Regular.ttf?base64'

export const OG_FONT_FAMILY = 'Noto Sans TC'

export const ogFonts = [
  {
    name: OG_FONT_FAMILY,
    data: Buffer.from(regular, 'base64'),
    weight: 400 as const,
    style: 'normal' as const,
  },
  {
    name: OG_FONT_FAMILY,
    data: Buffer.from(bold, 'base64'),
    weight: 700 as const,
    style: 'normal' as const,
  },
]
