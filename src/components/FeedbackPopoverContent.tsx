import { useState } from 'react'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { Button } from './ui/button'

const POSITIVE_OPTIONS = [
  'Right tone',
  'Good length',
  'Accurate sources',
  'Persuasive',
]

const NEGATIVE_OPTIONS = [
  'Too long',
  'Too short',
  'Missed the point',
  'Incorrect or outdated info',
  'Insufficient sources',
  "Response doesn't match sources",
  'Cites nonexistent sources',
  'Source summary is wrong',
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
