import { isCategoryDisputed } from '../-lib'
import type { CategoryVotes } from '../-lib'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ArticleCategoryItem = CategoryVotes & {
  categoryId: string
  title: string
}

/**
 * The message's categories (rumors-site's ArticleCategories), and 「建議分類」, which
 * opens the dialog to mark categories and vote on them. A category more people
 * disagree with than agree with stays listed, struck through, as on rumors-site.
 */
export function ArticleCategories({
  categories,
  onSuggest,
}: {
  categories: Array<ArticleCategoryItem>
  onSuggest: () => void
}) {
  return (
    <div className="flex flex-col gap-spacing-8">
      <h3 className="text-type-ui-m-bold text-text-primary">訊息分類</h3>
      <div className="flex flex-wrap items-center gap-spacing-8">
        {categories.length > 0 ? (
          <ul className="contents">
            {categories.map((category) => {
              const disputed = isCategoryDisputed(category)
              return (
                <li
                  key={category.categoryId}
                  className={cn(
                    'rounded-full border border-border-subtle bg-surface-raised px-spacing-12 py-spacing-4 text-type-ui-s text-text-primary',
                    disputed && 'text-text-secondary line-through',
                  )}
                >
                  <span aria-hidden="true"># </span>
                  {category.title}
                  {disputed && (
                    <span className="sr-only">（多數人不同意）</span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-type-body-s text-text-secondary">還沒有分類。</p>
        )}
        <Button variant="outline" size="sm" iconStart="add" onClick={onSuggest}>
          建議分類
        </Button>
      </div>
    </div>
  )
}
