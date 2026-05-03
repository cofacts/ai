import { useState } from 'react'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { Button } from './ui/button'

const POSITIVE_OPTIONS = ['語氣適合', '篇幅適中', '出處精準', '具有說服力']

const NEGATIVE_OPTIONS = [
  '篇幅過長',
  '篇幅過短',
  '沒抓到重點',
  '出處不足',
  '回應文字與出處不符',
  '提供不存在的出處',
  '出處摘要錯誤',
]

interface FeedbackPopoverContentProps {
  isPositive: boolean
  onSubmit: (comment: string) => void
}

export function FeedbackPopoverContent({
  isPositive,
  onSubmit,
}: FeedbackPopoverContentProps) {
  const options = isPositive ? POSITIVE_OPTIONS : NEGATIVE_OPTIONS
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [comment, setComment] = useState('')

  const handleToggleOption = (option: string) => {
    const newOptions = new Set(selectedOptions)
    if (newOptions.has(option)) {
      newOptions.delete(option)
    } else {
      newOptions.add(option)
    }
    setSelectedOptions(newOptions)
  }

  const handleSubmit = () => {
    let finalComment = ''
    selectedOptions.forEach((opt) => {
      finalComment += `☑ ${opt}\n`
    })
    if (comment.trim()) {
      finalComment += comment.trim()
    }
    onSubmit(finalComment.trim())
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="font-medium text-sm">Tell us more</h4>
        {options.map((option) => (
          <label
            key={option}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selectedOptions.has(option)}
              onCheckedChange={() => handleToggleOption(option)}
            />
            {option}
          </label>
        ))}
      </div>
      <Textarea
        placeholder="Additional comments..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="min-h-[80px]"
      />
      <Button onClick={handleSubmit} size="sm">
        Submit
      </Button>
    </div>
  )
}
