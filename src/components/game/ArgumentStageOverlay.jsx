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
        title: 'OPENING ARGUMENTS',
        wordLabel: judge ? `${judge.name} reveals` : 'Judge word',
        message:
          'Make your opening argument, then mark argued. Betting resumes after every active player is marked.',
        speakers: openingArgumentSpeakers,
        phaseKey: 'opening',
        markPlayerId: openingArgumentMarkPlayerId,
      }
    : isClosingArgumentGate
      ? {
          activeKey: `closing-arguments-${game.handNumber}`,
          kicker: 'Words Revealed',
          title: 'CLOSING ARGUMENTS',
          wordLabel: judge ? `${judge.name}'s judge word` : 'Neutral judge word',
          judgeWord,
          message:
            'Argue the revealed words. Voting begins after every contender is marked.',
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
