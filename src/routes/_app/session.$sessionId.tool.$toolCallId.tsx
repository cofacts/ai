import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useChat } from '@/hooks/useChat'
import { RightDrawer } from '@/components/RightDrawer'

export const Route = createFileRoute('/_app/session/$sessionId/tool/$toolCallId')({
  component: ToolDrawer,
})

function ToolDrawer() {
  const { sessionId, toolCallId } = useParams({
    from: '/_app/session/$sessionId/tool/$toolCallId',
  })
  const navigate = useNavigate()
  const { toolInvocations } = useChat({ sessionId })

  const handleClose = useCallback(() => {
    navigate({
      to: '/session/$sessionId',
      params: { sessionId },
      viewTransition: true,
    })
  }, [sessionId, navigate])

  const invocation = toolInvocations[toolCallId] ?? null

  return <RightDrawer isOpen={true} onClose={handleClose} invocation={invocation} />
}
