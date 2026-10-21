import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { FeedbackPopoverContent } from './FeedbackPopoverContent'
import { useAuth } from '@/lib/auth'
import {
  getFeedbackForTrace,
  submitFeedbackForTrace,
} from '@/server/feedbackScores.functions'

interface FeedbackButtonsProps {
  traceId: string
}

export function FeedbackButtons({ traceId }: FeedbackButtonsProps) {
  const { user } = useAuth()
  const [feedbackGiven, setFeedbackGiven] = useState<1 | -1 | null>(null)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  const { data: persistedFeedback } = useQuery({
    queryKey: ['feedback', traceId, user?.id ?? null],
    queryFn: () => getFeedbackForTrace({ data: traceId }),
    enabled: !!user,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (persistedFeedback) setFeedbackGiven(persistedFeedback.value)
  }, [persistedFeedback])

  const submitFeedback = useMutation({
    mutationFn: (input: { value: 1 | -1 | 0; comment?: string }) =>
      submitFeedbackForTrace({ data: { traceId, ...input } }),
  })

  const handleFeedback = (value: 1 | -1) => {
    const next = feedbackGiven === value ? null : value
    setFeedbackGiven(next)

    if (next === null) {
      setIsPopoverOpen(false)
      submitFeedback.mutate({ value: 0, comment: '' })
    } else {
      setIsPopoverOpen(true)
      submitFeedback.mutate({ value: next })
    }
  }

  const handleCommentSubmit = (comment: string) => {
    setIsPopoverOpen(false)
    if (feedbackGiven === null) return
    submitFeedback.mutate({ value: feedbackGiven, comment })
  }

  return (
    <div className="flex items-center gap-12 pt-8 mt-16 border-t border-subtle w-full">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open) setIsPopoverOpen(false)
        }}
      >
        <div className="flex gap-12">
          <PopoverTrigger
            onClick={() => handleFeedback(1)}
            aria-label="有幫助"
            aria-pressed={feedbackGiven === 1}
            className={`p-4 rounded-5 transition-colors ${
              feedbackGiven === 1
                ? 'bg-accent-subtle text-on-accent'
                : 'text-tertiary hover:bg-raised hover:text-secondary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_up
            </span>
          </PopoverTrigger>
          <PopoverTrigger
            onClick={() => handleFeedback(-1)}
            aria-label="沒有幫助"
            aria-pressed={feedbackGiven === -1}
            className={`p-4 rounded-5 hover:bg-raised transition-colors ${
              feedbackGiven === -1
                ? 'text-status-incorrect'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_down
            </span>
          </PopoverTrigger>
        </div>
        <PopoverContent align="start">
          <FeedbackPopoverContent
            isPositive={feedbackGiven === 1}
            onSubmit={handleCommentSubmit}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
