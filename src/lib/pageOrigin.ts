import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

/**
 * This site's origin (https://host), for absolute URLs such as og:url. On the
 * server it is the page request's origin, so a preview deploy points at itself;
 * in the browser, the current page's. Call it from a route loader or head(), not
 * from a server function: their request is the internal /_serverFn endpoint.
 */
export const getPageOrigin = createIsomorphicFn()
  .server(() => {
    const request = getRequest()
    const url = new URL(request.url)
    // Cloud Run ends TLS in front of the container, so the request itself may say http.
    const proto = request.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
    if (proto === 'https' || proto === 'http') url.protocol = `${proto}:`
    return url.origin
  })
  .client(() => window.location.origin)
