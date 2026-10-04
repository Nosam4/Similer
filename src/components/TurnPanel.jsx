import './GameUsability.css'

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
  controlsDisabled = false,
  isOnlinePlaying = false,
  isMyTurnOnline = false,
  legal,
  potSummary,
  amountInput,
  setAmountInput,
  onRunAction,
  pulseTick = 0,
}) {
  const isWaiting = isOnlinePlaying && !isMyTurnOnline
  const canSetBetTarget = legal.bet || legal.raise
  const contribution = actor?.betThisStreet ?? 0
  const minimumTarget = legal.raise ? legal.minRaiseTo : legal.minBetTo
  const targetInput = String(amountInput ?? '')
  const betTarget = targetInput.trim() === '' ? minimumTarget : Number(targetInput)
  const isValidTarget = Number.isSafeInteger(betTarget) &&
    betTarget >= minimumTarget && betTarget <= legal.maxTo && betTarget > contribution
  // The engine takes a street total. For an opening bet, show the chips being added.
  const inputOffset = legal.raise ? 0 : contribution
  const displayedAmount = targetInput.trim() === ''
    ? (minimumTarget ?? 0) - inputOffset
    : Number.isFinite(betTarget) ? betTarget - inputOffset : targetInput
  const committedAmount = isValidTarget ? betTarget - contribution : null
  const actionLabel = legal.raise ? 'Raise' : 'Bet'

  return (
    <div
      key={`turn-panel-${pulseTick}`}
      className={`turn-panel${isMyTurnOnline ? ' your-turn-panel' : ''}${pulseTick > 0 ? ' stage-pulse stage-pulse-subtle' : ''}`}
      data-actor-name={actor?.name ?? ''}
    >
      <div className="turn-heading" role="status" aria-live="polite">
        <h3>
          {isOnlinePlaying
            ? isMyTurnOnline ? 'Your turn' : `Waiting for ${actor?.name ?? 'the next player'}`
            : actor ? `${actor.name}'s turn` : 'Waiting for the next player'}
        </h3>
        <p>
          {isWaiting ? 'The table will update when they act.'
            : legal.call ? `${legal.callAmount} chips to call · ${actor?.stack ?? 0} available`
              : actor ? `You can check · ${actor.stack} chips available` : 'The next round will begin soon.'}
        </p>
      </div>

      {!isWaiting && actor ? (
        <>
          {canSetBetTarget ? (
            <div className="amount-row betting-amount-row">
              <div className="bet-amount-field">
                <label htmlFor="amount-input">{legal.raise ? 'Raise total to' : 'Bet amount'}</label>
                <input
                  id="amount-input"
                  type="number"
                  inputMode="numeric"
                  min={minimumTarget - inputOffset}
                  max={legal.maxTo - inputOffset}
                  step="1"
                  disabled={controlsDisabled}
                  value={displayedAmount}
                  onChange={(event) => {
                    const value = event.target.value
                    setAmountInput(value === '' ? '' : String(Number(value) + inputOffset))
                  }}
                  aria-describedby="bet-amount-hint"
                  aria-invalid={!isValidTarget}
                />
                <span id="bet-amount-hint" className={isValidTarget ? 'bet-amount-hint' : 'bet-amount-hint invalid-amount'}>
                  {isValidTarget ? '' : 'Enter a whole number · '}
                  {minimumTarget - inputOffset}–{legal.maxTo - inputOffset} chips
                </span>
              </div>
              <div className="bet-presets" aria-label="Quick bet amounts">
                <button
                  type="button"
                  className="quick-bet-button"
                  disabled={controlsDisabled}
                  onClick={() => setAmountInput(String(minimumTarget))}
                >
                  {legal.raise ? 'Min Raise' : 'Min Bet'}
                </button>
                <button
                  type="button"
                  className="quick-bet-button"
                  disabled={controlsDisabled}
                  onClick={() => setAmountInput(String(getPotBetTarget({ legal, potSummary, fraction: 0.5 })))}
                >
                  1/2 Pot
                </button>
                <button
                  type="button"
                  className="quick-bet-button"
                  disabled={controlsDisabled}
                  onClick={() => setAmountInput(String(getPotBetTarget({ legal, potSummary, fraction: 1 })))}
                >
                  Pot
                </button>
                <button
                  type="button"
                  className="quick-bet-button"
                  disabled={controlsDisabled}
                  onClick={() => setAmountInput(String(legal.maxTo))}
                >
                  Max
                </button>
              </div>
            </div>
          ) : null}

          <div className="action-row betting-action-row">
            {legal.check ? (
              <button type="button" className="action-button check-action" disabled={controlsDisabled} onClick={() => onRunAction('check')}>
                Check
              </button>
            ) : null}
            {legal.call ? (
              <button type="button" className="action-button call-action" disabled={controlsDisabled} onClick={() => onRunAction('call')}>
                Call {legal.callAmount}
              </button>
            ) : null}
            {canSetBetTarget ? (
              <button
                type="button"
                className={`action-button ${legal.raise ? 'raise-action' : 'bet-action'}`}
                disabled={controlsDisabled || !isValidTarget}
                onClick={() => onRunAction(legal.raise ? 'raise' : 'bet', betTarget)}
              >
                {isValidTarget ? legal.raise ? `Raise to ${betTarget}` : `Bet ${committedAmount}` : actionLabel}
                {legal.raise && isValidTarget ? <span className="action-chip-detail">Add {committedAmount} chips</span> : null}
              </button>
            ) : null}
            {legal.allIn ? (
              <button type="button" className="action-button all-in-action" disabled={controlsDisabled} onClick={() => onRunAction('all-in')}>
                All-in {actor.stack}
              </button>
            ) : null}
            {legal.fold ? (
              <button type="button" className="action-button fold-action" disabled={controlsDisabled} onClick={() => onRunAction('fold')}>
                Fold
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

export default TurnPanel
