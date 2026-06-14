function BustedPanel({ playerName }) {
  return (
    <div className="busted-panel" role="status" aria-live="polite">
      <h3>BUSTED</h3>
      <p>
        {playerName ? `${playerName}, you're out of chips.` : "You're out of chips."}
      </p>
      <p>
        You can still watch the table. You cannot act in betting, but you can vote
        during Showdown Voting.
      </p>
    </div>
  )
}

export default BustedPanel
