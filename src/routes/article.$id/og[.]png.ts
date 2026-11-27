import { createFileRoute } from '@tanstack/react-router'

import { ogImageVersion, ogVerdict } from './-lib'
import { renderArticleCard } from '@/server/og/articleCard.server'
import { cofactsExec } from '@/server/cofacts.server'
import { graphql } from '@/server/gql'

/**
 * /article/:id/og.png — the share-preview image of one article (og:image of
 * /article/:id). Every article gets its own card, drawn from its own data.
 *
 * Caching: og:image links here with ?v=<ogImageVersion>, which changes whenever
 * the card would. That URL is cached for a year as immutable; any other URL
 * (no ?v=, or an old one) for an hour. The version is also the ETag, so a
 * crawler that comes back gets a 304 without a new render.
 *
 * REMINDER: Cloud Run has no CDN in front, so these headers help crawlers (LINE,
 * Facebook) and browsers only; every new crawler still renders the card once.
 */

export const OG_CACHE_CONTROL = {
  /** ?v= matches the current version: the URL names this exact card. */
  versioned: 'public, max-age=31536000, immutable',
  /** No ?v=, or an old one: the card may change. */
  unversioned: 'public, max-age=3600, stale-while-revalidate=86400',
  notFound: 'public, max-age=300',
  /** rumors-api failed: don't let anyone keep the error. */
  error: 'no-store',
} as const

const GetOgArticle = graphql(`
  query GetOgArticle($id: String!) {
    GetArticle(id: $id) {
      id
      text
      articleType
      status
      replyRequestCount
      # PREVIEW is webp, which resvg can't read; THUMBNAIL is a JPEG.
      thumbnailUrl: attachmentUrl(variant: THUMBNAIL)
      articleReplies(statuses: [NORMAL]) {
        replyType
      }
    }
  }
`)

const IMAGE_TIMEOUT_MS = 5_000

/** The image message's thumbnail as a data URL, or null if it can't be fetched in time. */
async function fetchImageDataUrl(url: string) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!/^image\/(jpeg|png)/.test(type)) return null
    const data = Buffer.from(await res.arrayBuffer())
    return `data:${type};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

export async function handleOgImage({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) {
  let article
  try {
    // Anonymous: the image is cached publicly, so it must not depend on who asks.
    ;({ GetArticle: article } = await cofactsExec(
      GetOgArticle,
      { id: params.id },
      { anonymous: true },
    ))
  } catch {
    return new Response('Could not load the article', {
      status: 503,
      headers: { 'Cache-Control': OG_CACHE_CONTROL.error },
    })
  }
  if (!article) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': OG_CACHE_CONTROL.notFound },
    })
  }

  const replyTypes = article.articleReplies.map((reply) => reply.replyType)
  const version = ogImageVersion({
    status: article.status,
    replyTypes,
    replyRequestCount: article.replyRequestCount,
  })
  const etag = `"${version}"`
  const headers = {
    'Cache-Control':
      new URL(request.url).searchParams.get('v') === version
        ? OG_CACHE_CONTROL.versioned
        : OG_CACHE_CONTROL.unversioned,
    ETag: etag,
  }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }

  // A blocked article shows neither its text nor its image, even to crawlers.
  const blocked = article.status === 'BLOCKED'
  const png = await renderArticleCard({
    text: blocked ? null : (article.text ?? ''),
    articleType: article.articleType,
    imageDataUrl:
      !blocked && article.articleType === 'IMAGE' && article.thumbnailUrl
        ? await fetchImageDataUrl(article.thumbnailUrl)
        : null,
    verdict: ogVerdict(replyTypes),
    replyRequestCount: article.replyRequestCount ?? 0,
  })
  return new Response(new Uint8Array(png), {
    headers: { ...headers, 'Content-Type': 'image/png' },
  })
}

export const Route = createFileRoute('/article/$id/og.png')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleOgImage({ request, params }),
    },
  },
})
