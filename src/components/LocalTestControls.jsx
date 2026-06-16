const LOCAL_TEST_PLAYER_COUNTS = [3, 4, 5, 6, 7, 8]

function LocalTestControls({
  playerCount,
  onSelectPlayerCount,
  wordPacks = [],
  selectedWordPackId = '',
  onSelectWordPack,
}) {
  return (
    <section className="local-test-controls" aria-label="Local test player controls">
      <div className="local-test-copy">
        <strong>Local Test Table</strong>
        <span>Restart with:</span>
      </div>

      {wordPacks.length > 0 ? (
        <label className="local-word-pack-select">
          <span>Word Pack</span>
          <select
            value={selectedWordPackId}
            onChange={(event) => onSelectWordPack?.(event.target.value)}
          >
            {wordPacks.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name} ({pack.words.length})
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
