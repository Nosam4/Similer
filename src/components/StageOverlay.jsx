import { useState } from 'react'

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
  ownWord = '',
  canOverride = false,
  busy = false,
  errorText = '',
  onMarkArgument,
  onForceComplete,
}) {
  const ownWordVisibilityKey = `${activeKey}:${ownWord}`
  const [ownWordVisibility, setOwnWordVisibility] = useState({
    key: ownWordVisibilityKey,
    visible: false,
  })
  const showOwnWord =
    ownWordVisibility.key === ownWordVisibilityKey ? ownWordVisibility.visible : false

  if (!activeKey) {
    return null
  }

  const arguedCount = speakers.filter((speaker) => speaker.argued).length
  const totalCount = speakers.length
  const markedSpeaker = speakers.find((speaker) => speaker.playerId === markPlayerId) ?? null
  const canShowOwnWord = Boolean(markedSpeaker && ownWord)
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
        {canShowOwnWord ? (
          <div className="stage-overlay-own-word">
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={showOwnWord}
                onChange={(event) => {
                  setOwnWordVisibility({
                    key: ownWordVisibilityKey,
                    visible: event.target.checked,
                  })
                }}
              />
              <span className="stage-overlay-switch" aria-hidden="true" />
              <span>{showOwnWord ? 'Hide my word' : 'Show my word'}</span>
            </label>
            <p>
              Your word: <b>{showOwnWord ? ownWord : '••••••'}</b>
            </p>
          </div>
        ) : null}
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
        {errorText ? (
          <p className="stage-overlay-error" role="alert">
            {errorText}
          </p>
        ) : null}
      </div>
    </aside>
  )
}

export default StageOverlay
