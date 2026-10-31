import { BrandIcon } from './BrandIcon'
import { MaterialIcon } from './MaterialIcon'
import { MATERIAL_SYMBOLS } from './material-symbols'
import { StatusIcon } from './StatusIcon'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'icons/Icons',
  component: MaterialIcon,
  parameters: { penpot: { component: 'Base/Icon' } },
  args: { name: 'search' },
  argTypes: { name: { control: 'select', options: MATERIAL_SYMBOLS } },
} satisfies Meta<typeof MaterialIcon>

export default meta
type Story = StoryObj<typeof meta>

/** `MaterialIcon` with its props: pick a name from `material-symbols.ts`, toggle `filled`. */
export const Default: Story = {}

function Cell({ penpot, children }: { penpot: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-spacing-8">
      {children}
      <code className="text-type-caption text-text-secondary">{penpot}</code>
    </div>
  )
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
      <Cell penpot="rss">
        <MaterialIcon name="rss_feed" />
      </Cell>
      <Cell penpot="More-Horiz">
        <MaterialIcon name="more_horiz" />
      </Cell>
      <Cell penpot="Arrow-Back">
        <MaterialIcon name="arrow_back" />
      </Cell>
      <Cell penpot="Arrow-Forward">
        <MaterialIcon name="arrow_forward" />
      </Cell>
      <Cell penpot="Open-In-New">
        <MaterialIcon name="open_in_new" />
      </Cell>
      <Cell penpot="Bookmark">
        <MaterialIcon name="bookmark" />
      </Cell>
      <Cell penpot="Bookmark-fill">
        <MaterialIcon name="bookmark" filled />
      </Cell>
      <Cell penpot="Keyboard-Arrow-Down">
        <MaterialIcon name="keyboard_arrow_down" />
      </Cell>
      <Cell penpot="Keyboard-Arrow-Up">
        <MaterialIcon name="keyboard_arrow_up" />
      </Cell>
      <Cell penpot="Search">
        <MaterialIcon name="search" />
      </Cell>
      <Cell penpot="Check">
        <MaterialIcon name="check" />
      </Cell>
      <Cell penpot="status-pending">
        <StatusIcon type="OPINIONATED" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell penpot="status-correct">
        <StatusIcon type="NOT_RUMOR" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell penpot="status-false">
        <StatusIcon type="RUMOR" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell penpot="status-out-of-scope">
        <StatusIcon type="NOT_ARTICLE" className="size-[22px] md:size-[22px]" />
      </Cell>
      <Cell penpot="Account-Circle">
        <MaterialIcon name="account_circle" />
      </Cell>
      <Cell penpot="Menu">
        <MaterialIcon name="menu" />
      </Cell>
      <Cell penpot="Close">
        <MaterialIcon name="close" />
      </Cell>
      <Cell penpot="Mail">
        <MaterialIcon name="mail" />
      </Cell>
      <Cell penpot="fb">
        <BrandIcon name="facebook" />
      </Cell>
      <Cell penpot="line">
        <BrandIcon name="line" />
      </Cell>
      <Cell penpot="Build">
        <MaterialIcon name="build" filled />
      </Cell>
      <Cell penpot="Thumb Down">
        <MaterialIcon name="thumb_down" filled />
      </Cell>
      <Cell penpot="Thumb Up">
        <MaterialIcon name="thumb_up" filled />
      </Cell>
      <Cell penpot="Arrow Drop Down">
        <MaterialIcon name="arrow_drop_down" />
      </Cell>
      <Cell penpot="edit">
        <MaterialIcon name="edit" />
      </Cell>
      <Cell penpot="plus">
        <MaterialIcon name="add" />
      </Cell>
      <Cell penpot="Link">
        <MaterialIcon name="link" />
      </Cell>
      <Cell penpot="flag">
        <MaterialIcon name="flag_2" filled />
      </Cell>
      <Cell penpot="Error">
        <MaterialIcon name="error" />
      </Cell>
      <Cell penpot="Format List Bulleted">
        <MaterialIcon name="format_list_bulleted" />
      </Cell>
      <Cell penpot="Format List Numbered">
        <MaterialIcon name="format_list_numbered" />
      </Cell>
      <Cell penpot="Add Reaction">
        <MaterialIcon name="add_reaction" />
      </Cell>
      <Cell penpot="send">
        <MaterialIcon name="send" />
      </Cell>
      <Cell penpot="Attach File">
        <MaterialIcon name="attach_file" />
      </Cell>
      <Cell penpot="Help">
        <MaterialIcon name="help" />
      </Cell>
      <Cell penpot="Content Copy">
        <MaterialIcon name="content_copy" />
      </Cell>
      <Cell penpot="Filter List">
        <MaterialIcon name="filter_list" />
      </Cell>
      <Cell penpot="report">
        <MaterialIcon name="flag_check" filled />
      </Cell>
      <Cell penpot="Edit Document">
        <MaterialIcon name="edit_document" />
      </Cell>
      <Cell penpot="Side Navigation">
        <MaterialIcon name="side_navigation" />
      </Cell>
    </div>
  ),
}
