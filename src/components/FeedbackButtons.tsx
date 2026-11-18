import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { FeedbackPopoverContent } from './FeedbackPopoverContent'
import { useAuth } from '@/lib/auth'
import {
  getFeedbackForTrace,
  submitFeedbackForTrace,
} from '@/server/feedbackScores.functions'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

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
    <div className="flex items-center gap-spacing-12 pt-spacing-8 mt-spacing-16 border-t border-border-subtle w-full">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open) setIsPopoverOpen(false)
        }}
      >
        <div className="flex gap-spacing-12">
          {/* Like Penpot's ReactionGroup and the 收藏 Toggle: outline icon, then the solid icon in
              the brand color once chosen. */}
          <PopoverTrigger
            onClick={() => handleFeedback(1)}
            aria-label="讚"
            aria-pressed={feedbackGiven === 1}
            className={`p-spacing-4 rounded-radius-5 transition-colors hover:bg-surface-raised ${
              feedbackGiven === 1
                ? 'text-icon-brand'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <MaterialIcon
              name="thumb_up"
              filled={feedbackGiven === 1}
              size={24}
            />
          </PopoverTrigger>
          <PopoverTrigger
            onClick={() => handleFeedback(-1)}
            aria-label="倒讚"
            aria-pressed={feedbackGiven === -1}
            className={`p-spacing-4 rounded-radius-5 transition-colors hover:bg-surface-raised ${
              feedbackGiven === -1
                ? 'text-icon-brand'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <MaterialIcon
              name="thumb_down"
              filled={feedbackGiven === -1}
              size={24}
            />
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
