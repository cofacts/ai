import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  addArticleCategory,
  listCategoryDisagreements,
  voteArticleCategory,
} from '../-categories.functions'
import { cofactsExec } from '@/server/cofacts.server'

vi.mock('@tanstack/react-start', () => import('@/test/createServerFnMock'))
vi.mock('@/server/cofacts.server', () => ({ cofactsExec: vi.fn() }))

const mockedExec = vi.mocked(cofactsExec)

afterEach(() => {
  vi.clearAllMocks()
})

function lastVariables() {
  return mockedExec.mock.calls.at(-1)?.[1]
}

describe('voteArticleCategory', () => {
  test('sends a disagreement with its trimmed reason', async () => {
    mockedExec.mockResolvedValueOnce({})
    await voteArticleCategory({
      data: {
        articleId: 'a1',
        categoryId: 'c1',
        vote: 'DOWNVOTE',
        comment: '  跟健康無關  ',
      },
    })
    expect(lastVariables()).toEqual({
      articleId: 'a1',
      categoryId: 'c1',
      vote: 'DOWNVOTE',
      comment: '跟健康無關',
    })
  })

  test('drops a reason from an agreement, and an empty one', async () => {
    mockedExec.mockResolvedValue({})
    await voteArticleCategory({
      data: { articleId: 'a1', categoryId: 'c1', vote: 'UPVOTE', comment: 'x' },
    })
    expect(lastVariables()).toMatchObject({ comment: undefined })
    await voteArticleCategory({
      data: {
        articleId: 'a1',
        categoryId: 'c1',
        vote: 'DOWNVOTE',
        comment: ' ',
      },
    })
    expect(lastVariables()).toMatchObject({ comment: undefined })
  })

  test('rejects any other vote', async () => {
    await expect(
      voteArticleCategory({
        // @ts-expect-error a value the type forbids, as a hand-made request could send
        data: { articleId: 'a1', categoryId: 'c1', vote: 'NEUTRAL' },
      }),
    ).rejects.toThrow('vote must be UPVOTE or DOWNVOTE')
    expect(mockedExec).not.toHaveBeenCalled()
  })
})

describe('addArticleCategory', () => {
  test('rejects a missing id', async () => {
    await expect(
      addArticleCategory({ data: { articleId: 'a1', categoryId: '' } }),
    ).rejects.toThrow('categoryId must be text')
    expect(mockedExec).not.toHaveBeenCalled()
  })
})

describe('listCategoryDisagreements', () => {
  test("returns only the asked category's disagreements that have a reason", async () => {
    mockedExec.mockResolvedValueOnce({
      GetArticle: {
        articleCategories: [
          {
            categoryId: 'other',
            feedbacks: [
              { id: 'f0', vote: 'DOWNVOTE', comment: '別的分類', user: null },
            ],
          },
          {
            categoryId: 'c1',
            feedbacks: [
              {
                id: 'f1',
                vote: 'DOWNVOTE',
                comment: ' 不相關 ',
                user: { name: '小明' },
              },
              { id: 'f2', vote: 'UPVOTE', comment: '同意', user: null },
              { id: 'f3', vote: 'DOWNVOTE', comment: '', user: null },
              { id: 'f4', vote: 'DOWNVOTE', comment: '沒寫名字', user: null },
            ],
          },
        ],
      },
    })
    await expect(
      listCategoryDisagreements({
        data: { articleId: 'a1', categoryId: 'c1' },
      }),
    ).resolves.toEqual([
      { id: 'f1', comment: '不相關', userName: '小明' },
      { id: 'f4', comment: '沒寫名字', userName: null },
    ])
  })
})
