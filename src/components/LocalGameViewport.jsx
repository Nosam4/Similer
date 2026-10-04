import { useLayoutEffect, useRef, useState } from 'react'
import HowToPlay from './HowToPlay'
import useDialogFocus from './useDialogFocus'
import './Viewport.css'

const DRAWER_TITLES = {
  setup: 'Local Setup',
  log: 'Action Log',
  help: 'How to play',
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
  showGame = true,
  isPractice = false,
  onGoOnline,
}) {
  const [activeDrawer, setActiveDrawer] = useState(null)
  const viewportRef = useRef(null)
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, left: 0 })
  }, [showGame, eyebrow])
  const hasSetupPanel = showGame && Boolean(setupPanel)
  const visibleDrawer = (activeDrawer === 'setup' && !hasSetupPanel) || (activeDrawer === 'log' && !showGame) ? null : activeDrawer
  const drawerTitle = visibleDrawer ? DRAWER_TITLES[visibleDrawer] : ''
  const drawerContent =
    visibleDrawer === 'setup'
      ? setupPanel
      : visibleDrawer === 'log'
        ? logPanel
        : visibleDrawer === 'help' ? <HowToPlay isPractice={isPractice} /> : null
  const drawerRef = useDialogFocus({
    isOpen: Boolean(visibleDrawer),
    dialogKey: visibleDrawer,
    onClose: () => setActiveDrawer(null),
  })

  function toggleDrawer(drawerName) {
    setActiveDrawer((currentDrawer) => (currentDrawer === drawerName ? null : drawerName))
  }

  return (
    <main ref={viewportRef} className={`local-game-viewport ${showGame ? 'is-game' : 'is-home'}${isPractice ? ' is-practice' : ''}`}>
      {showGame && confetti}
      {showGame && stageOverlay}

      <header className="local-game-topbar">
        <div className="local-game-brand">
          <span>{eyebrow}</span>
          <strong>Similer</strong>
        </div>

        <nav className="local-game-tools" aria-label="Table tools">
          {isPractice && <button type="button" onClick={onGoOnline}>Play online</button>}
          <button type="button" aria-haspopup="dialog" aria-expanded={visibleDrawer === 'help'} onClick={() => toggleDrawer('help')}>How to play</button>
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
          {showGame && <button
            type="button"
            className={activeDrawer === 'log' ? 'active' : ''}
            aria-pressed={activeDrawer === 'log'}
            onClick={() => toggleDrawer('log')}
          >
            Log
          </button>}
        </nav>
      </header>

      <div className="local-game-room-surface" hidden={isPractice}>{headerPanel}</div>

      {showGame && <section className="local-game-stage" aria-label="Game table">
        {table}
      </section>}

      {showGame && <section className="local-game-actionbar" aria-label="Game actions">
        {actionPanel}
      </section>}

      {visibleDrawer ? (
        <div
          className="local-game-scrim"
          aria-hidden="true"
        />
      ) : null}

      {visibleDrawer ? (
        <aside ref={drawerRef} tabIndex={-1} className="local-game-drawer is-open" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
          <div className="local-game-drawer-header">
            <h2 id="drawer-title">{drawerTitle}</h2>
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
