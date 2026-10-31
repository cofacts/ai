import { StatusIcon } from '../StatusIcon'
import { Icon, iconNames } from './icon'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Icon',
  component: Icon,
  parameters: { penpot: { component: 'Base/Icon' } },
  args: { name: 'search' },
  argTypes: { name: { control: 'select', options: iconNames } },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

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
 * Every icon on Penpot's Base/Icon, in its order, labelled with its Penpot name. Show the code to
 * see what to write for each: most are a Material Symbol by name (`filled` for the solid ones),
 * fb and line are brand marks, and the four status icons are `StatusIcon` (22px here, as on
 * Base/Icon; its default is the result-title size).
 * A Material Symbol not listed here must first be added to `material-symbols.ts`.
 */
export const Penpot: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-spacing-16 text-icon-default">
      <Cell penpot="rss">
        <Icon name="rss_feed" />
      </Cell>
      <Cell penpot="More-Horiz">
        <Icon name="more_horiz" />
      </Cell>
      <Cell penpot="Arrow-Back">
        <Icon name="arrow_back" />
      </Cell>
      <Cell penpot="Arrow-Forward">
        <Icon name="arrow_forward" />
      </Cell>
      <Cell penpot="Open-In-New">
        <Icon name="open_in_new" />
      </Cell>
      <Cell penpot="Bookmark">
        <Icon name="bookmark" />
      </Cell>
      <Cell penpot="Bookmark-fill">
        <Icon name="bookmark" filled />
      </Cell>
      <Cell penpot="Keyboard-Arrow-Down">
        <Icon name="keyboard_arrow_down" />
      </Cell>
      <Cell penpot="Keyboard-Arrow-Up">
        <Icon name="keyboard_arrow_up" />
      </Cell>
      <Cell penpot="Search">
        <Icon name="search" />
      </Cell>
      <Cell penpot="Check">
        <Icon name="check" />
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
        <Icon name="account_circle" />
      </Cell>
      <Cell penpot="Menu">
        <Icon name="menu" />
      </Cell>
      <Cell penpot="Close">
        <Icon name="close" />
      </Cell>
      <Cell penpot="Mail">
        <Icon name="mail" />
      </Cell>
      <Cell penpot="fb">
        <Icon name="facebook" />
      </Cell>
      <Cell penpot="line">
        <Icon name="line" />
      </Cell>
      <Cell penpot="Build">
        <Icon name="build" filled />
      </Cell>
      <Cell penpot="Thumb Down">
        <Icon name="thumb_down" filled />
      </Cell>
      <Cell penpot="Thumb Up">
        <Icon name="thumb_up" filled />
      </Cell>
      <Cell penpot="Arrow Drop Down">
        <Icon name="arrow_drop_down" />
      </Cell>
      <Cell penpot="edit">
        <Icon name="edit" />
      </Cell>
      <Cell penpot="plus">
        <Icon name="add" />
      </Cell>
      <Cell penpot="Link">
        <Icon name="link" />
      </Cell>
      <Cell penpot="flag">
        <Icon name="flag_2" filled />
      </Cell>
      <Cell penpot="Error">
        <Icon name="error" />
      </Cell>
      <Cell penpot="Format List Bulleted">
        <Icon name="format_list_bulleted" />
      </Cell>
      <Cell penpot="Format List Numbered">
        <Icon name="format_list_numbered" />
      </Cell>
      <Cell penpot="Add Reaction">
        <Icon name="add_reaction" />
      </Cell>
      <Cell penpot="send">
        <Icon name="send" />
      </Cell>
      <Cell penpot="Attach File">
        <Icon name="attach_file" />
      </Cell>
      <Cell penpot="Help">
        <Icon name="help" />
      </Cell>
      <Cell penpot="Content Copy">
        <Icon name="content_copy" />
      </Cell>
      <Cell penpot="Filter List">
        <Icon name="filter_list" />
      </Cell>
      <Cell penpot="report">
        <Icon name="flag_check" filled />
      </Cell>
      <Cell penpot="Edit Document">
        <Icon name="edit_document" />
      </Cell>
      <Cell penpot="Side Navigation">
        <Icon name="side_navigation" />
      </Cell>
    </div>
  ),
}
