function StageOverlay({ activeKey, title, judgeWord }) {
  if (!activeKey) {
    return null
  }

  return (
    <aside
      key={activeKey}
      className="stage-overlay"
      role="status"
      aria-live="polite"
      aria-label={`${title}. Judge word: ${judgeWord ?? 'pending'}. Make your case.`}
    >
      <div className="stage-overlay-card">
        <p className="stage-overlay-kicker">New Phase</p>
        <h2>{title}</h2>
        <p>
          Judge word: <b>{judgeWord ?? 'revealed word'}</b>
        </p>
        <p>Make your case. Why is your word the closest?</p>
      </div>
    </aside>
  )
}

export default StageOverlay
