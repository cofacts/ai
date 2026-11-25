import { isCategoryDisputed } from '../-lib'
import type { CategoryVotes } from '../-lib'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ArticleCategoryItem = CategoryVotes & {
  categoryId: string
  title: string
}

/**
 * The message's categories (Penpot Feedback/Category, rumors-site's ArticleCategories) and
 * 「分類建議」, which opens the dialog to mark categories and vote on them. Each category is a
 * Base/Badge-styled chip that can't be pressed: src/components/ui/badge.tsx is a filter toggle.
 * A category more people disagree with than agree with stays listed, struck through, as on
 * rumors-site (not in Penpot). Penpot shows no heading and no empty state, so the list is named
 * for screen readers only and a message without categories shows just the button.
 */
export function ArticleCategories({
  categories,
  onSuggest,
}: {
  categories: Array<ArticleCategoryItem>
  onSuggest: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-spacing-8">
      {categories.length > 0 && (
        <ul aria-label="訊息分類" className="contents">
          {categories.map((category) => {
            const disputed = isCategoryDisputed(category)
            return (
              <li
                key={category.categoryId}
                className={cn(
                  'rounded-full border border-border-control bg-surface-raised px-spacing-16 py-spacing-8 text-type-ui-m text-text-primary',
                  disputed && 'text-text-secondary line-through',
                )}
              >
                <span aria-hidden="true"># </span>
                {category.title}
                {disputed && <span className="sr-only">（多數人不同意）</span>}
              </li>
            )
          })}
        </ul>
      )}
      <Button variant="outline" size="md" iconStart="add" onClick={onSuggest}>
        分類建議
      </Button>
    </div>
  )
}
