import { BrandIcon, brands } from './BrandIcon'
import { MaterialIcon } from './MaterialIcon'
import { MATERIAL_SYMBOLS } from './material-symbols'
import { StatusIcon, replyTypes } from './StatusIcon'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/Icons',
  component: MaterialIcon,
  parameters: { penpot: { component: 'Base/Icon' } },
  args: { name: 'search', filled: false, size: 20 },
  argTypes: {
    name: { control: 'select', options: MATERIAL_SYMBOLS },
    filled: { control: 'boolean' },
    size: { control: { type: 'range', min: 12, max: 64, step: 2 } },
  },
} satisfies Meta<typeof MaterialIcon>

export default meta
type Story = StoryObj<typeof meta>

/**
 * `MaterialIcon`: pick a name from `material-symbols.ts`, and try `filled` and `size` in the
 * controls.
 */
export const Material: Story = { name: 'MaterialIcon' }

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-spacing-8">
      {children}
      <code className="text-type-caption text-text-secondary">{label}</code>
    </div>
  )
}

/** `BrandIcon`: every brand mark. */
export const Brand: Story = {
  name: 'BrandIcon',
  render: () => (
    <div className="flex flex-wrap gap-spacing-24 text-icon-default">
      {brands.map((name) => (
        <Cell key={name} label={name}>
          <BrandIcon name={name} />
        </Cell>
      ))}
    </div>
  ),
}

/** `StatusIcon`: the four fact-check results, at their default (result-title) size. */
export const Status: Story = {
  name: 'StatusIcon',
  render: () => (
    <div className="flex flex-wrap gap-spacing-24">
      {replyTypes.map((type) => (
        <Cell key={type} label={type}>
          <StatusIcon type={type} />
        </Cell>
      ))}
    </div>
  ),
}

/**
 * Every icon on [Penpot Base/Icon](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=d3600d97-74cb-80be-8008-50a68919781b),
 * in its order, labelled with its Penpot name. Show the code to see what to write for each:
 *
 * - `MaterialIcon` for most, by Material Symbol name (`filled` for the solid ones). To use one
 *   that isn't listed, add its name to `material-symbols.ts` first.
 * - `BrandIcon` for fb and line.
 * - `StatusIcon` for the four fact-check results (22px here, as on Base/Icon; its default is the
 *   result-title size).
 */
export const Penpot: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-spacing-16 text-icon-default">
      <Cell label="rss">
        <MaterialIcon name="rss_feed" />
      </Cell>
      <Cell label="More-Horiz">
        <MaterialIcon name="more_horiz" />
      </Cell>
      <Cell label="Arrow-Back">
        <MaterialIcon name="arrow_back" />
      </Cell>
      <Cell label="Arrow-Forward">
        <MaterialIcon name="arrow_forward" />
      </Cell>
      <Cell label="Open-In-New">
        <MaterialIcon name="open_in_new" />
      </Cell>
      <Cell label="Bookmark">
        <MaterialIcon name="bookmark" />
      </Cell>
      <Cell label="Bookmark-fill">
        <MaterialIcon name="bookmark" filled />
      </Cell>
      <Cell label="Keyboard-Arrow-Down">
        <MaterialIcon name="keyboard_arrow_down" />
      </Cell>
      <Cell label="Keyboard-Arrow-Up">
        <MaterialIcon name="keyboard_arrow_up" />
      </Cell>
      <Cell label="Search">
        <MaterialIcon name="search" />
      </Cell>
      <Cell label="Check">
        <MaterialIcon name="check" />
      </Cell>
      <Cell label="status-pending">
        <StatusIcon type="OPINIONATED" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell label="status-correct">
        <StatusIcon type="NOT_RUMOR" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell label="status-false">
        <StatusIcon type="RUMOR" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell label="status-out-of-scope">
        <StatusIcon type="NOT_ARTICLE" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell label="Account-Circle">
        <MaterialIcon name="account_circle" />
      </Cell>
      <Cell label="Menu">
        <MaterialIcon name="menu" />
      </Cell>
      <Cell label="Close">
        <MaterialIcon name="close" />
      </Cell>
      <Cell label="Mail">
        <MaterialIcon name="mail" />
      </Cell>
      <Cell label="fb">
        <BrandIcon name="facebook" />
      </Cell>
      <Cell label="line">
        <BrandIcon name="line" />
      </Cell>
      <Cell label="Build">
        <MaterialIcon name="build" filled />
      </Cell>
      <Cell label="Thumb Down">
        <MaterialIcon name="thumb_down" filled />
      </Cell>
      <Cell label="Thumb Up">
        <MaterialIcon name="thumb_up" filled />
      </Cell>
      <Cell label="Arrow Drop Down">
        <MaterialIcon name="arrow_drop_down" />
      </Cell>
      <Cell label="edit">
        <MaterialIcon name="edit" />
      </Cell>
      <Cell label="plus">
        <MaterialIcon name="add" />
      </Cell>
      <Cell label="Link">
        <MaterialIcon name="link" />
      </Cell>
      <Cell label="flag">
        <MaterialIcon name="flag_2" filled />
      </Cell>
      <Cell label="Error">
        <MaterialIcon name="error" />
      </Cell>
      <Cell label="Format List Bulleted">
        <MaterialIcon name="format_list_bulleted" />
      </Cell>
      <Cell label="Format List Numbered">
        <MaterialIcon name="format_list_numbered" />
      </Cell>
      <Cell label="Add Reaction">
        <MaterialIcon name="add_reaction" />
      </Cell>
      <Cell label="send">
        <MaterialIcon name="send" />
      </Cell>
      <Cell label="Attach File">
        <MaterialIcon name="attach_file" />
      </Cell>
      <Cell label="Help">
        <MaterialIcon name="help" />
      </Cell>
      <Cell label="Content Copy">
        <MaterialIcon name="content_copy" />
      </Cell>
      <Cell label="Filter List">
        <MaterialIcon name="filter_list" />
      </Cell>
      <Cell label="report">
        <MaterialIcon name="flag_check" filled />
      </Cell>
      <Cell label="Edit Document">
        <MaterialIcon name="edit_document" />
      </Cell>
      <Cell label="Side Navigation">
        <MaterialIcon name="side_navigation" />
      </Cell>
    </div>
  ),
}
