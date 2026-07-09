import { useState } from 'react'

const DRAWER_TITLES = {
  setup: 'Local Setup',
  room: 'Online Room',
  log: 'Action Log',
}

function LocalGameViewport({
  confetti,
  stageOverlay,
  handNumber,
  phaseLabel,
  playerCount,
  actorName,
  potTotal,
  setupPanel,
  roomPanel,
  table,
  actionPanel,
  logPanel,
}) {
  const [activeDrawer, setActiveDrawer] = useState(null)
  const drawerTitle = activeDrawer ? DRAWER_TITLES[activeDrawer] : ''
  const drawerContent =
    activeDrawer === 'setup'
      ? setupPanel
      : activeDrawer === 'room'
        ? roomPanel
        : activeDrawer === 'log'
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
          <span>Local Table</span>
          <strong>WhatGame</strong>
        </div>

        <div className="local-game-status" aria-label="Local hand status">
          <span>Hand {handNumber}</span>
          <span>{phaseLabel}</span>
          <span>Pot {potTotal}</span>
          <span>{actorName ? `${actorName} acts` : 'No actor'}</span>
          <span>{playerCount} seats</span>
        </div>

        <nav className="local-game-tools" aria-label="Local table tools">
          <button
            type="button"
            className={activeDrawer === 'setup' ? 'active' : ''}
            aria-pressed={activeDrawer === 'setup'}
            onClick={() => toggleDrawer('setup')}
          >
            Setup
          </button>
          <button
            type="button"
            className={activeDrawer === 'room' ? 'active' : ''}
            aria-pressed={activeDrawer === 'room'}
            onClick={() => toggleDrawer('room')}
          >
            Room
          </button>
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

      <section className="local-game-stage" aria-label="Local game table">
        {table}
      </section>

      <section className="local-game-actionbar" aria-label="Local game actions">
        {actionPanel}
      </section>

      {activeDrawer ? (
        <button
          type="button"
          className="local-game-scrim"
          aria-label="Close drawer"
          onClick={() => setActiveDrawer(null)}
        />
      ) : null}

      {activeDrawer ? (
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
