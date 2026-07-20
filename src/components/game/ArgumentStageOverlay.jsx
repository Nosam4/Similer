import StageOverlay from '../StageOverlay'

function buildArgumentSpeakerRows(game, progress, includeWords = false) {
  const playerById = new Map(game.players.map((player) => [player.id, player]))

  return (progress?.speakers ?? []).map((speaker) => {
    const player = playerById.get(speaker.playerId)

    return {
      ...speaker,
      word: includeWords ? player?.holeWord ?? '' : '',
    }
  })
}

function getStageOverlayOwnWord(game, stageOverlayConfig) {
  if (
    stageOverlayConfig?.phaseKey !== 'opening' ||
    stageOverlayConfig.markPlayerId === null ||
    !stageOverlayConfig.speakers.some((speaker) => {
      return speaker.playerId === stageOverlayConfig.markPlayerId
    })
  ) {
    return ''
  }

  return (
    game.players.find((player) => player.id === stageOverlayConfig.markPlayerId)?.holeWord ?? ''
  )
}

function ArgumentStageOverlay({
  busy = false,
  canForceCompleteArguments = false,
  closingArgumentMarkPlayerId = null,
  closingArgumentProgress,
  errorText = '',
  game,
  isDebate = false,
  isJudgeWordLive = false,
  judge,
  judgeWord,
  onForceComplete,
  onMarkArgument,
  openingArgumentMarkPlayerId = null,
  openingArgumentProgress,
}) {
  const openingArgumentSpeakers = buildArgumentSpeakerRows(game, openingArgumentProgress)
  const closingArgumentSpeakers = buildArgumentSpeakerRows(game, closingArgumentProgress, true)
  const isOpeningArgumentGate =
    isJudgeWordLive &&
    !openingArgumentProgress.complete &&
    openingArgumentProgress.speakers.length > 0
  const isClosingArgumentGate =
    isDebate &&
    !closingArgumentProgress.complete &&
    closingArgumentProgress.speakers.length > 0
  const stageOverlayConfig = isOpeningArgumentGate
    ? {
        activeKey: `opening-arguments-${game.handNumber}`,
        kicker: 'Judge Word Live',
        title: 'OPENING STATEMENTS',
        judgeName: judge?.name ?? 'Neutral Judge',
        wordLabel: "Judge's Word",
        message:
          "State your word, then argue why it connects to the Judge's Word. Creative reasoning—and bluffing—are fair game. Mark argued when you finish; betting resumes after every active player is marked.",
        speakers: openingArgumentSpeakers,
        phaseKey: 'opening',
        markPlayerId: openingArgumentMarkPlayerId,
      }
    : isClosingArgumentGate
      ? {
          activeKey: `closing-arguments-${game.handNumber}`,
          kicker: 'Words Revealed',
          title: 'CLOSING ARGUMENTS',
          judgeName: judge?.name ?? 'Neutral Judge',
          wordLabel: judge ? "Judge's Word" : "Neutral Judge's Word",
          judgeWord,
          message:
            'Make your final case to the Judge. Build on your opening argument, change your approach, or explain a bluff—whatever gives your real word the best chance to win. Mark argued when you finish; voting begins after every contender is marked.',
          speakers: closingArgumentSpeakers,
          phaseKey: 'closing',
          markPlayerId: closingArgumentMarkPlayerId,
        }
      : null
  const stageOverlayOwnWord = getStageOverlayOwnWord(game, stageOverlayConfig)

  return (
    <StageOverlay
      activeKey={stageOverlayConfig?.activeKey ?? ''}
      kicker={stageOverlayConfig?.kicker}
      title={stageOverlayConfig?.title}
      judgeName={stageOverlayConfig?.judgeName}
      judgeWord={judgeWord}
      wordLabel={stageOverlayConfig?.wordLabel}
      message={stageOverlayConfig?.message}
      speakers={stageOverlayConfig?.speakers}
      phaseKey={stageOverlayConfig?.phaseKey}
      markPlayerId={stageOverlayConfig?.markPlayerId}
      ownWord={stageOverlayOwnWord}
      canOverride={Boolean(stageOverlayConfig && canForceCompleteArguments)}
      busy={busy}
      errorText={stageOverlayConfig ? errorText : ''}
      onMarkArgument={onMarkArgument}
      onForceComplete={onForceComplete}
    />
  )
}

export default ArgumentStageOverlay
