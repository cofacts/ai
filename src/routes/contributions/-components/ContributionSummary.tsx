import type { ContributionSummaryData } from '@/lib/contributions'
import type { SiteNavUser } from '@/components/SiteNav'
import { UserAvatar } from '@/components/UserAvatar'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

const STATS = [
  { key: 'reports', label: '回報訊息' },
  { key: 'replies', label: '查核回應' },
  { key: 'feedbacks', label: '評價回應' },
] as const

/**
 * Top of 我的貢獻: who you are and your level, three plain totals (meeting notes: 簡單暴力的數字,
 * like the Google Maps contributions tab), and one line on the effect your replies had.
 */
export function ContributionSummary({
  profile,
  user,
  totals,
  upvotesReceived,
}: {
  profile: SiteNavUser
} & Pick<ContributionSummaryData, 'user' | 'totals' | 'upvotesReceived'>) {
  const { total, currentLevel, nextLevel } = user.points
  const progress =
    nextLevel && nextLevel > currentLevel
      ? Math.min(
          1,
          Math.max(0, (total - currentLevel) / (nextLevel - currentLevel)),
        )
      : 1

  return (
    <section
      aria-labelledby="contrib-profile"
      className="flex flex-col gap-spacing-16"
    >
      <div className="flex items-center gap-spacing-16">
        <UserAvatar user={profile} size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-spacing-4">
          <h1
            id="contrib-profile"
            className="truncate text-type-heading-m text-text-primary"
          >
            {profile.name ?? '我的貢獻'}
          </h1>
          <p className="text-type-ui-s text-text-secondary">
            Lv.{user.level} · {total.toLocaleString('zh-TW')} 點
            {nextLevel ? (
              <> · 再 {(nextLevel - total).toLocaleString('zh-TW')} 點升級</>
            ) : null}
          </p>
          <div
            role="progressbar"
            aria-label="升級進度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-spacing-8 w-full overflow-hidden rounded-full bg-surface-selected"
          >
            <div
              className="h-full rounded-full bg-surface-accent"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-border-subtle rounded-radius-10 border border-border-subtle">
        {STATS.map(({ key, label }) => (
          <div
            key={key}
            className="flex flex-col-reverse items-center gap-spacing-2 py-spacing-12"
          >
            <dt className="text-type-ui-s text-text-secondary">{label}</dt>
            <dd className="text-type-heading-l text-text-primary tabular-nums">
              {totals[key].toLocaleString('zh-TW')}
            </dd>
          </div>
        ))}
      </dl>

      {totals.replies > 0 && (
        <p className="flex items-start gap-spacing-8 rounded-radius-10 bg-surface-raised p-spacing-12 text-type-body-s text-text-primary">
          <MaterialIcon
            name="thumb_up"
            className="mt-spacing-2 text-icon-default"
          />
          <span>
            你寫的查核回應被評為「有幫助」
            <strong className="tabular-nums">
              {' '}
              {upvotesReceived.toLocaleString('zh-TW')}{' '}
            </strong>
            次。
          </span>
        </p>
      )}
    </section>
  )
}
