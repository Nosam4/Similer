const LOCAL_TEST_PLAYER_COUNTS = [3, 4, 5, 6, 7, 8]

function LocalTestControls({ playerCount, onSelectPlayerCount }) {
  return (
    <section className="local-test-controls" aria-label="Local test player controls">
      <div className="local-test-copy">
        <strong>Local Test Table</strong>
        <span>Restart with:</span>
      </div>

      <div className="local-test-buttons" aria-label="Choose local player count">
        {LOCAL_TEST_PLAYER_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            className={count === playerCount ? 'active' : ''}
            aria-pressed={count === playerCount}
            onClick={() => onSelectPlayerCount(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </section>
  )
}

export default LocalTestControls
