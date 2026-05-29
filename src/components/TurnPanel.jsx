function TurnPanel({
  actor,
  legal,
  amountInput,
  setAmountInput,
  onRunAction,
  pulseTick = 0,
}) {
  return (
    <div
      key={`turn-panel-${pulseTick}`}
      className={`turn-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-subtle' : ''}`}
    >
      <h3>Current Turn</h3>
      <p>
        {actor ? `${actor.name} to act.` : 'No active player.'} To call: {legal.callAmount}
      </p>

      <div className="amount-row">
        <label htmlFor="amount-input">Bet/Raise target</label>
        <input
          id="amount-input"
          type="number"
          min="0"
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
          placeholder="Enter target chips"
        />
        <button
          type="button"
          onClick={() => setAmountInput(String(legal.minBetTo ?? legal.maxTo ?? 0))}
        >
          Use Min Bet
        </button>
        <button
          type="button"
          onClick={() => setAmountInput(String(legal.minRaiseTo ?? legal.maxTo ?? 0))}
        >
          Use Min Raise
        </button>
        <button type="button" onClick={() => setAmountInput(String(legal.maxTo ?? 0))}>
          Use Max
        </button>
      </div>

      <div className="action-row">
        <button type="button" disabled={!legal.fold} onClick={() => onRunAction('fold')}>
          Fold
        </button>
        <button type="button" disabled={!legal.check} onClick={() => onRunAction('check')}>
          Check
        </button>
        <button type="button" disabled={!legal.call} onClick={() => onRunAction('call')}>
          Call ({legal.callAmount})
        </button>
        <button type="button" disabled={!legal.bet} onClick={() => onRunAction('bet')}>
          Bet
        </button>
        <button type="button" disabled={!legal.raise} onClick={() => onRunAction('raise')}>
          Raise
        </button>
        <button
          type="button"
          disabled={!legal.allIn}
          onClick={() => onRunAction('all-in')}
        >
          All-in
        </button>
      </div>
    </div>
  )
}

export default TurnPanel
