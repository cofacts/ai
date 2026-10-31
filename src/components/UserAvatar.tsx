import { Suspense, lazy } from 'react'
import type { CofactsUser } from '@/lib/auth'
import { cn } from '@/lib/utils'

const OpenPeepsAvatar = lazy(() => import('./OpenPeepsAvatar'))

const NULL_USER_IMG =
  'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp'

interface UserAvatarProps {
  user: Pick<CofactsUser, 'name' | 'avatarUrl' | 'avatarType' | 'avatarData'>
  size?: number
  className?: string
  /** Shows the "Lv N" badge (Penpot Base/Avatar Type = default / Certification-level). */
  level?: number
  /** Certified fact-checker: brand-yellow ring (Penpot Type = Certification). */
  certified?: boolean
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
  const displayName = user.name ?? ''
  return (
    <img
      src={src}
      alt={displayName}
      title={displayName}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}

/** Penpot Base/Avatar: the picture, with an optional certification ring and level badge. */
export function UserAvatar({
  user,
  size = 36,
  className,
  level,
  certified = false,
}: UserAvatarProps) {
  const picture = <AvatarPicture user={user} size={size} />
  if (level === undefined && !certified) {
    return (
      <span className={cn('inline-flex shrink-0', className)}>{picture}</span>
    )
  }
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 flex-col items-center',
        className,
      )}
      style={{ paddingBottom: level === undefined ? 0 : 6 }}
    >
      <span
        className={cn(
          'flex rounded-full',
          certified && 'border-2 border-border-accent',
        )}
      >
        {picture}
      </span>
      {level !== undefined && (
        // border-border-inverse has the same value as surface-base in both themes: it cuts the badge
        // out of the picture.
        <span className="absolute bottom-0 rounded-full border-2 border-border-inverse bg-surface-inverse px-spacing-8 py-spacing-2 text-type-ui-xs-bold whitespace-nowrap text-text-inverse">
          Lv{level}
        </span>
      )}
    </span>
  )
}

function AvatarPicture({
  user,
  size,
}: Pick<UserAvatarProps, 'user'> & { size: number }) {
  if (user.avatarType === 'OpenPeeps') {
    return (
      <Suspense fallback={<FallbackImg user={user} size={size} />}>
        <OpenPeepsAvatar
          avatarData={user.avatarData}
          size={size}
          name={user.name ?? ''}
        />
      </Suspense>
    )
  }

  return <FallbackImg user={user} size={size} />
}
