const PREFIX = 'session_opened_'

export function getLastOpenedTime(sessionId: string): number {
  const val = localStorage.getItem(PREFIX + sessionId)
  return val ? Number(val) : 0
}

export function setLastOpenedTime(sessionId: string): void {
  localStorage.setItem(PREFIX + sessionId, String(Date.now()))
}
