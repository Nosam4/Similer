function StageOverlay({
  activeKey,
  title,
  judgeWord,
  kicker = 'New Phase',
  wordLabel = 'Judge word',
  message = 'Make your case.',
  speakers = [],
  phaseKey = null,
  markPlayerId = null,
  canOverride = false,
  busy = false,
  onMarkArgument,
  onForceComplete,
}) {
  if (!activeKey) {
    return null
  }

  const arguedCount = speakers.filter((speaker) => speaker.argued).length
  const totalCount = speakers.length
  const markedSpeaker = speakers.find((speaker) => speaker.playerId === markPlayerId) ?? null
  const canMarkArgument = Boolean(
    phaseKey &&
      markedSpeaker &&
      !markedSpeaker.argued &&
      onMarkArgument,
  )

  return (
    <aside
      key={activeKey}
      className="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-label={`${title}. ${wordLabel}: ${judgeWord ?? 'pending'}. ${message}`}
    >
      <div className="stage-overlay-card">
        <div className="stage-overlay-heading">
          <p className="stage-overlay-kicker">{kicker}</p>
          {totalCount > 0 ? (
            <span>
              {arguedCount}/{totalCount}
            </span>
          ) : null}
        </div>
        <h2>{title}</h2>
        <p>
          {wordLabel}: <b>{judgeWord ?? 'revealed word'}</b>
        </p>
        <p>{message}</p>
        {speakers.some((speaker) => speaker.word) ? (
          <div className="stage-overlay-words" aria-label="Revealed player words">
            {speakers.map((speaker) => (
              <p key={`${phaseKey ?? 'speaker'}-${speaker.playerId}`}>
                <span>{speaker.playerName}</span>
                <b>{speaker.word}</b>
              </p>
            ))}
          </div>
        ) : null}
        {phaseKey ? (
          <div className="stage-overlay-actions">
            {markedSpeaker ? (
              <button
                type="button"
                disabled={!canMarkArgument || busy}
                onClick={() => onMarkArgument?.(markedSpeaker.playerId, phaseKey)}
              >
                {markedSpeaker.argued ? 'Marked Argued' : 'Mark Argued'}
              </button>
            ) : null}
            {!markedSpeaker && totalCount > 0 ? (
              <p className="stage-overlay-waiting">Waiting for arguments.</p>
            ) : null}
            {canOverride ? (
              <button
                type="button"
                className="stage-overlay-override"
                disabled={busy}
                onClick={() => onForceComplete?.(phaseKey)}
              >
                Override
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export default StageOverlay
