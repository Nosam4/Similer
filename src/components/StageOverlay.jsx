function StageOverlay({
  activeKey,
  title,
  judgeWord,
  kicker = 'New Phase',
  wordLabel = 'Judge word',
  message = 'Make your case.',
}) {
  if (!activeKey) {
    return null
  }

  return (
    <aside
      key={activeKey}
      className="stage-overlay"
      role="status"
      aria-live="polite"
      aria-label={`${title}. ${wordLabel}: ${judgeWord ?? 'pending'}. ${message}`}
    >
      <div className="stage-overlay-card">
        <p className="stage-overlay-kicker">{kicker}</p>
        <h2>{title}</h2>
        <p>
          {wordLabel}: <b>{judgeWord ?? 'revealed word'}</b>
        </p>
        <p>{message}</p>
      </div>
    </aside>
  )
}

export default StageOverlay
