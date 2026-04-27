import { useState } from 'react'
import { LangfuseWeb } from 'langfuse'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { FeedbackPopoverContent } from './FeedbackPopoverContent'

const langfuse = import.meta.env.VITE_LANGFUSE_PUBLIC_KEY
  ? new LangfuseWeb({
      publicKey: import.meta.env.VITE_LANGFUSE_PUBLIC_KEY,
      baseUrl: import.meta.env.VITE_LANGFUSE_BASE_URL,
    })
  : null

interface FeedbackButtonsProps {
  traceId: string
}

export function FeedbackButtons({ traceId }: FeedbackButtonsProps) {
  const [feedbackGiven, setFeedbackGiven] = useState<1 | -1 | null>(null)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  const handleFeedback = (value: 1 | -1) => {
    const next = feedbackGiven === value ? null : value
    setFeedbackGiven(next)

    if (next === null) {
      // Re-clicking same button -> clear feedback
      setIsPopoverOpen(false)
      if (langfuse) {
        langfuse.score({
          id: `user-${traceId}`,
          traceId,
          name: 'user-thumbs',
          value: 0,
          dataType: 'NUMERIC',
          comment: '',
        })
      }
    } else {
      // New feedback
      setIsPopoverOpen(true)
      if (langfuse) {
        langfuse.score({
          id: `user-${traceId}`,
          traceId,
          name: 'user-thumbs',
          value: next,
          dataType: 'NUMERIC',
        })
      }
    }
  }

  const handleCommentSubmit = (comment: string) => {
    setIsPopoverOpen(false)
    if (langfuse && feedbackGiven !== null) {
      langfuse.score({
        id: `user-${traceId}`,
        traceId,
        name: 'user-thumbs',
        value: feedbackGiven,
        dataType: 'NUMERIC',
        comment,
      })
    }
  }

  return (
    <div className="flex items-center gap-3 pt-2 mt-4 border-t border-gray-100 w-full">
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger render={<div className="flex gap-3" />}>
          <button
            onClick={() => handleFeedback(1)}
            className={`p-1 rounded hover:bg-gray-100 transition-colors ${
              feedbackGiven === 1
                ? 'text-primary'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_up
            </span>
          </button>
          <button
            onClick={() => handleFeedback(-1)}
            className={`p-1 rounded hover:bg-gray-100 transition-colors ${
              feedbackGiven === -1
                ? 'text-destructive'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_down
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start">
          <FeedbackPopoverContent onSubmit={handleCommentSubmit} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
