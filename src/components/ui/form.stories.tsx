import { expect } from 'storybook/test'

import { Checkbox } from './checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from './field'
import { Input } from './input'
import { Label } from './label'
import { RadioGroup, RadioGroupItem } from './radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select'
import { Switch } from './switch'
import { Textarea } from './textarea'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

/**
 * Penpot Base/Input, Checkbox, Switch, RadioGroup, Select.
 *
 * The play functions check the a11y guide's rule that a control's title is bound with <label>:
 * Base UI renders a role element next to a hidden <input>, so the role element itself must be
 * labelable for the wrapping <label> to name it, and clicking the text must toggle it once.
 */
const meta = {
  title: 'ui/Form controls',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Inputs: Story = {
  parameters: { penpot: { component: 'Base/Input' } },
  render: () => (
    <div className="flex w-[277px] flex-col gap-spacing-24">
      <Input placeholder="輸入關鍵字" aria-label="關鍵字" />
      <Input defaultValue="世紀颱風" aria-label="關鍵字" />
      <Input placeholder="輸入關鍵字" aria-label="關鍵字" disabled />
      <Field>
        <FieldLabel htmlFor="title">標題</FieldLabel>
        <Input id="title" placeholder="輸入關鍵字" />
        <FieldDescription>項目的說明文字</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="url">網址</FieldLabel>
        <Input
          id="url"
          defaultValue="not a url"
          aria-invalid
          aria-describedby="url-error"
        />
        <FieldError id="url-error">請輸入正確的網址</FieldError>
      </Field>
      <Textarea placeholder="輸入關鍵字" aria-label="內容" />
    </div>
  ),
}

export const Checkboxes: Story = {
  parameters: { penpot: { component: 'Base/Checkbox' } },
  render: () => (
    <div className="flex flex-col gap-spacing-16">
      <Label>
        <Checkbox />
        標題
      </Label>
      <Label>
        <Checkbox defaultChecked />
        已勾選
      </Label>
      <Label>
        <Checkbox disabled />
        停用
      </Label>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: '標題' })
    await expect(canvas.getByRole('checkbox', { name: '已勾選' })).toBeChecked()
    await userEvent.click(canvas.getByText('標題'))
    await expect(checkbox).toBeChecked()
  },
}

export const Switches: Story = {
  parameters: { penpot: { component: 'Base/Switch' } },
  render: () => (
    <div className="flex flex-col gap-spacing-16">
      <Label>
        <Switch />
        標題
      </Label>
      <Label>
        <Switch defaultChecked />
        開啟
      </Label>
      <Label>
        <Switch disabled />
        停用
      </Label>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('switch', { name: '標題' })
    await expect(canvas.getByRole('switch', { name: '開啟' })).toBeChecked()
    await userEvent.click(canvas.getByText('標題'))
    await expect(toggle).toBeChecked()
  },
}

export const Radios: Story = {
  parameters: { penpot: { component: 'Base/RadioGroup' } },
  render: () => (
    <FieldSet>
      <FieldLegend variant="label">訊息類型</FieldLegend>
      <RadioGroup defaultValue="text">
        <Label>
          <RadioGroupItem value="text" />
          文字
        </Label>
        <Label>
          <RadioGroupItem value="image" />
          圖片
        </Label>
        <Label>
          <RadioGroupItem value="video" disabled />
          影片（停用）
        </Label>
      </RadioGroup>
    </FieldSet>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('radio', { name: '文字' })).toBeChecked()
    await userEvent.click(canvas.getByText('圖片'))
    await expect(canvas.getByRole('radio', { name: '圖片' })).toBeChecked()
  },
}

const sortItems = [
  { label: '最新回報', value: 'lastRequestedAt' },
  { label: '最多回報', value: 'replyRequestCount' },
  { label: '最新回應', value: 'lastRepliedAt' },
]

export const Selects: Story = {
  parameters: { penpot: { component: 'Base/Select' } },
  render: () => (
    <div className="flex gap-spacing-16">
      <Select items={sortItems} defaultValue="lastRequestedAt">
        <SelectTrigger aria-label="排序">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>排序方式</SelectLabel>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select items={sortItems} defaultValue="lastRequestedAt">
        <SelectTrigger size="sm" aria-label="排序">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
}
