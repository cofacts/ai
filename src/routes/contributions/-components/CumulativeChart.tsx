import type { CumulativePoint } from '@/lib/contributions'

/** `2026-11-09` → `11/9`. */
function shortDate(date: string) {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

/**
 * 累積貢獻: a running total, so the line never drops (a quiet week is flat, not a dip).
 * The line is SVG stretched to the box; labels are HTML so they keep their size on a phone.
 * Screen readers get the figure caption; the drawing itself is decorative.
 */
export function CumulativeChart({
  series,
}: {
  series: ReadonlyArray<CumulativePoint>
}) {
  const first = series[0]
  const last = series.at(-1)
  if (!first || !last) return null

  const gained = series.reduce((sum, p) => sum + p.added, 0)
  // Scale from where the window started, so growth inside it is visible.
  const min = first.total - first.added
  const max = last.total > min ? last.total : min + 1
  // Point 0 is the start of the window; point i + 1 is the end of week i.
  const x = (i: number) => (i / series.length) * 100
  const y = (v: number) => 4 + (1 - (v - min) / (max - min)) * 92
  const points = [
    `${x(0)},${y(min)}`,
    ...series.map((p, i) => `${x(i + 1)},${y(p.total)}`),
  ].join(' ')

  return (
    <figure className="flex flex-col gap-spacing-8 rounded-radius-10 border border-border-subtle p-spacing-16">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-spacing-12">
        <span className="text-type-ui-m-bold text-text-primary">累積貢獻</span>
        <span className="text-type-ui-s text-text-secondary">
          共{' '}
          <span className="tabular-nums">
            {last.total.toLocaleString('zh-TW')}
          </span>{' '}
          次 · 過去 {series.length} 週 +
          <span className="tabular-nums">{gained.toLocaleString('zh-TW')}</span>
        </span>
      </figcaption>

      <div className="relative h-[120px]" aria-hidden="true">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {[4, 50, 96].map((gy) => (
            <line
              key={gy}
              x1="0"
              x2="100"
              y1={gy}
              y2={gy}
              className="stroke-border-subtle"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon
            points={`0,100 ${points} 100,100`}
            className="fill-surface-accent-subtle"
            fillOpacity="0.6"
          />
          <polyline
            points={points}
            fill="none"
            className="stroke-icon-brand"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute size-spacing-12 -translate-1/2 rounded-full border-[3px] border-border-accent bg-surface-base"
          style={{ left: '100%', top: `${y(last.total)}%` }}
        />
      </div>

      <div
        className="flex justify-between pt-spacing-4 text-type-caption text-text-tertiary"
        aria-hidden="true"
      >
        <span className="tabular-nums">
          {shortDate(first.weekStart)} · {min.toLocaleString('zh-TW')} 次
        </span>
        <span className="tabular-nums">
          本週 · {last.total.toLocaleString('zh-TW')} 次
        </span>
      </div>
    </figure>
  )
}
