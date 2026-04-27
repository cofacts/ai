import { useState } from 'react'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { Button } from './ui/button'

const FEEDBACK_OPTIONS = [
  'Inaccurate information',
  'Unhelpful',
  'Outdated information',
  'Other',
]

interface FeedbackPopoverContentProps {
  onSubmit: (comment: string) => void
}

export function FeedbackPopoverContent({
  onSubmit,
}: FeedbackPopoverContentProps) {
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
        {FEEDBACK_OPTIONS.map((option) => (
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
