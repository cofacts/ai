import { Suspense, lazy } from 'react'
import type { CofactsUser } from '@/lib/auth'

const OpenPeepsAvatar = lazy(() => import('./OpenPeepsAvatar'))

const NULL_USER_IMG =
  'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp'

interface UserAvatarProps {
  user: Pick<CofactsUser, 'name' | 'avatarUrl' | 'avatarType' | 'avatarData'>
  size?: number
  className?: string
}

function FallbackImg({
  user,
  size,
  className,
}: {
  user: UserAvatarProps['user']
  size: number
  className?: string
}) {
  const src = user.avatarUrl ?? NULL_USER_IMG
  return (
    <img
      src={src}
      alt={user.name}
      title={user.name}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  )
}

export function UserAvatar({ user, size = 36, className }: UserAvatarProps) {
  if (user.avatarType === 'OpenPeeps') {
    return (
      <Suspense
        fallback={<FallbackImg user={user} size={size} className={className} />}
      >
        <OpenPeepsAvatar
          avatarData={user.avatarData}
          size={size}
          name={user.name}
          className={className}
        />
      </Suspense>
    )
  }

  return <FallbackImg user={user} size={size} className={className} />
}
