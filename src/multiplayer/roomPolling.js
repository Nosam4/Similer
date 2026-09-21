export const ROOM_FALLBACK_POLL_INTERVAL_MS = 2_500
const HEALTHY_ROOM_POLL_INTERVAL_MS = 30_000

export function shouldPollRoom({ connectionMode, lastPolledAt, now }) {
  const interval = connectionMode === 'live'
    ? HEALTHY_ROOM_POLL_INTERVAL_MS
    : ROOM_FALLBACK_POLL_INTERVAL_MS

  return now - lastPolledAt >= interval
}
