import type { MaterialSymbol as AnyMaterialSymbol } from 'material-symbols'

/**
 * The Material Symbols this app uses, and the Google Fonts request that loads them.
 *
 * **To use an icon that isn't here, add its name to this list.** The request asks only for
 * these glyphs (`icon_names`): a 9 KB font instead of about 550 KB for every icon. A name that
 * isn't listed fails the type check of `<MaterialIcon name>`, and would render as plain text.
 * Names are on https://fonts.google.com/icons; `satisfies` checks each one against every Material
 * Symbol name (the `material-symbols` package's type), so a typo fails the type check here.
 *
 * The designer's settings (Penpot page "UI system", board "Icons"): style Rounded, fill 0,
 * weight 400, grade 0, optical size 20. Fill also loads 1, for solid icons
 * (`<MaterialIcon filled>`).
 */
export const MATERIAL_SYMBOLS = [
  'account_circle',
  'add',
  'add_reaction',
  'arrow_back',
  'arrow_drop_down',
  'arrow_forward',
  'attach_file',
  'bookmark',
  'build',
  'calendar_today',
  'cancel',
  'check',
  'check_circle',
  'close',
  'comment',
  'content_copy',
  'description',
  'edit',
  'edit_document',
  'error',
  'fact_check',
  'filter_list',
  'flag_2',
  'flag_check',
  'format_list_bulleted',
  'format_list_numbered',
  'group',
  'help',
  'keyboard_arrow_down',
  'keyboard_arrow_up',
  'language',
  'link',
  'mail',
  'menu',
  'more_horiz',
  'notifications',
  'open_in_new',
  'person',
  'picture_as_pdf',
  'rss_feed',
  'search',
  'send',
  'shield',
  'side_navigation',
  'smart_toy',
  'stop',
  'subdirectory_arrow_right',
  'thumb_down',
  'thumb_up',
  'trending_up',
  'upload_file',
  'warning',
] as const satisfies ReadonlyArray<AnyMaterialSymbol>

export type MaterialSymbol = (typeof MATERIAL_SYMBOLS)[number]

/** Loaded by `__root.tsx` and Storybook's preview head. `display=block` hides the ligature text until the font is ready. */
export const materialSymbolsHref = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,400,0..1,0&icon_names=${[...MATERIAL_SYMBOLS].sort().join(',')}&display=block`
