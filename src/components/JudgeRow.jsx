function JudgeRow({ judge, judgeWord = null, pulseTick = 0 }) {
  return (
    <section
      key={`judge-row-${pulseTick}`}
      className={`judge-row${pulseTick > 0 ? ' stage-pulse stage-pulse-strongest' : ''}`}
    >
      <strong>Judge</strong>
      {judge ? (
        <span>
          {judge.name} | Word: <b>{judge.holeWord}</b>
        </span>
      ) : judgeWord ? (
        <span>
          Neutral Judge Word: <b>{judgeWord}</b>
        </span>
      ) : (
        <span>Judge not assigned yet (revealed after preflop).</span>
      )}
    </section>
  )
}

export default JudgeRow
