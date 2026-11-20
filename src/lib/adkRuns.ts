/**
 * Whether an ADK /runs response says background runs are off (no Redis).
 *
 * Only then do callers fall back to the old /run_sse behaviour. Any other
 * 503 (ADK shutting down for a redeploy, Cloud Run itself) means "try again":
 * falling back then would start a run that takes no lock, alongside one
 * another window may start properly.
 */
export async function isRunsDisabled(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    const body = (await res.clone().json()) as {
      detail?: { reason?: string }
    }
    return body.detail?.reason === 'disabled'
  } catch {
    return false
  }
}
