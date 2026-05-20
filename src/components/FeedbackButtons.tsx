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
    <div className="flex items-center gap-3 pt-2 mt-4 border-t border-gray-100 w-full">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open) setIsPopoverOpen(false)
        }}
      >
        <div className="flex gap-3">
          <PopoverTrigger
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
          </PopoverTrigger>
          <PopoverTrigger
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
