/**
 * The two Penpot board widths, for stories that compare with Penpot. Spread `viewportOptions`
 * into a meta's `parameters.viewport.options`, then pick one per story with `globals`.
 */
export const viewportOptions = {
  penpotMobile: {
    name: 'Penpot mobile (375)',
    styles: { width: '375px', height: '812px' },
    type: 'mobile',
  },
  penpotDesktop: {
    name: 'Penpot desktop (1440)',
    styles: { width: '1440px', height: '900px' },
    type: 'desktop',
  },
} as const

export const mobile = {
  viewport: { value: 'penpotMobile', isRotated: false },
} as const
export const desktop = {
  viewport: { value: 'penpotDesktop', isRotated: false },
} as const
