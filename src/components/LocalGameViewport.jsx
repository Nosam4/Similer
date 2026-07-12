import { useState } from 'react'

const DRAWER_TITLES = {
  setup: 'Local Setup',
  log: 'Action Log',
}

function LocalGameViewport({
  confetti,
  stageOverlay,
  eyebrow = 'Local Table',
  headerPanel,
  setupPanel,
  table,
  actionPanel,
  logPanel,
}) {
  const [activeDrawer, setActiveDrawer] = useState(null)
  const hasSetupPanel = Boolean(setupPanel)
  const visibleDrawer = activeDrawer === 'setup' && !hasSetupPanel ? null : activeDrawer
  const drawerTitle = visibleDrawer ? DRAWER_TITLES[visibleDrawer] : ''
  const drawerContent =
    visibleDrawer === 'setup'
      ? setupPanel
      : visibleDrawer === 'log'
        ? logPanel
        : null

  function toggleDrawer(drawerName) {
    setActiveDrawer((currentDrawer) => (currentDrawer === drawerName ? null : drawerName))
  }

  return (
    <main className="local-game-viewport">
      {confetti}
      {stageOverlay}

      <header className="local-game-topbar">
        <div className="local-game-brand">
          <span>{eyebrow}</span>
          <strong>Similer</strong>
        </div>

        <div className="local-game-header-room">{headerPanel}</div>

        <nav className="local-game-tools" aria-label="Table tools">
          {hasSetupPanel ? (
            <button
              type="button"
              className={activeDrawer === 'setup' ? 'active' : ''}
              aria-pressed={activeDrawer === 'setup'}
              onClick={() => toggleDrawer('setup')}
            >
              Setup
            </button>
          ) : null}
          <button
            type="button"
            className={activeDrawer === 'log' ? 'active' : ''}
            aria-pressed={activeDrawer === 'log'}
            onClick={() => toggleDrawer('log')}
          >
            Log
          </button>
        </nav>
      </header>

      <section className="local-game-stage" aria-label="Game table">
        {table}
      </section>

      <section className="local-game-actionbar" aria-label="Game actions">
        {actionPanel}
      </section>

      {visibleDrawer ? (
        <button
          type="button"
          className="local-game-scrim"
          aria-label="Close drawer"
          onClick={() => setActiveDrawer(null)}
        />
      ) : null}

      {visibleDrawer ? (
        <aside className="local-game-drawer is-open" role="dialog" aria-modal="true">
          <div className="local-game-drawer-header">
            <h2>{drawerTitle}</h2>
            <button type="button" onClick={() => setActiveDrawer(null)}>
              Close
            </button>
          </div>

          <div className="local-game-drawer-body">{drawerContent}</div>
        </aside>
      ) : null}
    </main>
  )
}

export default LocalGameViewport
