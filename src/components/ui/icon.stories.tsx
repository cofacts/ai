import { Icon, iconNames } from './icon'
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

export const All: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-16 text-icon-default">
      {iconNames.map((name) => (
        <div key={name} className="flex flex-col items-center gap-8">
          <Icon name={name} />
          <code className="text-caption text-secondary">{name}</code>
        </div>
      ))}
    </div>
  ),
}
