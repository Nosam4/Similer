function StatusRow({
  handNumber,
  phaseLabel,
  potSummary,
  wordBankSize,
  phasePulseTick = 0,
}) {
  return (
    <section className="status-row">
      <div>
        <strong>Hand</strong>
        <span>{handNumber}</span>
      </div>
      <div
        key={`phase-tile-${phasePulseTick}`}
        className={`status-phase${phasePulseTick > 0 ? ' stage-pulse stage-pulse-strong' : ''}`}
      >
        <strong>Phase</strong>
        <span>{phaseLabel}</span>
      </div>
      <div>
        <strong>Total Pot</strong>
        <span>{potSummary.totalPot}</span>
      </div>
      <div>
        <strong>Current Bet</strong>
        <span>{potSummary.currentBet}</span>
      </div>
      <div>
        <strong>Min Raise</strong>
        <span>{potSummary.minRaise}</span>
      </div>
      <div>
        <strong>Word Bank</strong>
        <span>{wordBankSize}</span>
      </div>
    </section>
  )
}

export default StatusRow
