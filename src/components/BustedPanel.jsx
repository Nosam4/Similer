function BustedPanel({ playerName }) {
  return (
    <div className="busted-panel" role="status" aria-live="polite">
      <h3>BUSTED</h3>
      <p>
        {playerName ? `${playerName}, you're out of chips.` : "You're out of chips."}
      </p>
      <p>You can still watch the table, but you cannot act or vote until a new game starts.</p>
    </div>
  )
}

export default BustedPanel
