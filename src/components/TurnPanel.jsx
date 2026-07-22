function clampBetTarget(target, legal) {
  const minimumTarget = legal.raise ? legal.minRaiseTo : legal.minBetTo
  const maximumTarget = legal.maxTo

  if (minimumTarget === null || maximumTarget === null) {
    return 0
  }

  return Math.min(Math.max(target, minimumTarget), maximumTarget)
}

function getPotBetTarget({ legal, potSummary, fraction }) {
  const potTotal = potSummary?.totalPot ?? 0
  const currentBet = potSummary?.currentBet ?? 0
  const callAmount = legal.callAmount ?? 0
  const rawTarget = legal.raise
    ? currentBet + Math.ceil((potTotal + callAmount) * fraction)
    : Math.ceil(potTotal * fraction)

  return clampBetTarget(rawTarget, legal)
}

function TurnPanel({
  actor,
  busy = false,
  legal,
  potSummary,
  amountInput,
  setAmountInput,
  onRunAction,
  pulseTick = 0,
}) {
  const canSetBetTarget = legal.bet || legal.raise

  return (
    <div
      key={`turn-panel-${pulseTick}`}
      className={`turn-panel${pulseTick > 0 ? ' stage-pulse stage-pulse-subtle' : ''}`}
    >
      <h3>Current Turn</h3>
      <p>
        {actor ? `${actor.name} to act.` : 'No active player.'} To call: {legal.callAmount}
      </p>

      <div className="amount-row betting-amount-row">
        <label htmlFor="amount-input">Bet/Raise target</label>
        <input
          id="amount-input"
          type="number"
          min="0"
          disabled={busy}
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
          placeholder="Enter target chips"
        />
        <button
          type="button"
          className="quick-bet-button"
          disabled={busy || !legal.bet}
          onClick={() => setAmountInput(String(legal.minBetTo ?? legal.maxTo ?? 0))}
        >
          Min Bet
        </button>
        <button
          type="button"
          className="quick-bet-button"
          disabled={busy || !legal.raise}
          onClick={() => setAmountInput(String(legal.minRaiseTo ?? legal.maxTo ?? 0))}
        >
          Min Raise
        </button>
        <button
          type="button"
          className="quick-bet-button"
          disabled={busy || !canSetBetTarget}
          onClick={() => {
            setAmountInput(String(getPotBetTarget({ legal, potSummary, fraction: 0.5 })))
          }}
        >
          1/2 Pot
        </button>
        <button
          type="button"
          className="quick-bet-button"
          disabled={busy || !canSetBetTarget}
          onClick={() => {
            setAmountInput(String(getPotBetTarget({ legal, potSummary, fraction: 1 })))
          }}
        >
          Pot
        </button>
        <button
          type="button"
          className="quick-bet-button"
          disabled={busy || !canSetBetTarget}
          onClick={() => setAmountInput(String(legal.maxTo ?? 0))}
        >
          Max
        </button>
      </div>

      <div className="action-row betting-action-row">
        <button
          type="button"
          className="action-button fold-action"
          disabled={busy || !legal.fold}
          onClick={() => onRunAction('fold')}
        >
          Fold
        </button>
        <button
          type="button"
          className="action-button check-action"
          disabled={busy || !legal.check}
          onClick={() => onRunAction('check')}
        >
          Check
        </button>
        <button
          type="button"
          className="action-button call-action"
          disabled={busy || !legal.call}
          onClick={() => onRunAction('call')}
        >
          Call ({legal.callAmount})
        </button>
        <button
          type="button"
          className="action-button bet-action"
          disabled={busy || !legal.bet}
          onClick={() => onRunAction('bet')}
        >
          Bet
        </button>
        <button
          type="button"
          className="action-button raise-action"
          disabled={busy || !legal.raise}
          onClick={() => onRunAction('raise')}
        >
          Raise
        </button>
        <button
          type="button"
          className="action-button all-in-action"
          disabled={busy || !legal.allIn}
          onClick={() => onRunAction('all-in')}
        >
          All-in
        </button>
      </div>
    </div>
  )
}

export default TurnPanel
