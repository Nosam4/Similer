import {
  applyPlayerAction,
  createInitialGame,
  forceCompleteArguments,
  getLegalActions,
  markArgumentComplete,
  resolveShowdownVotes,
  startNextHand,
} from '../wordgame/engine'
import { getWordPackById } from '../wordgame/wordPacks'
import { invokeGameCommand, submitShowdownVote } from '../multiplayer/roomApi'

const PLAYER_NAMES = ['North', 'East', 'South', 'West']
const LOCAL_TEST_PLAYER_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function getOnlinePlayerNames(players) {
  const names = [...players]
    .sort((left, right) => left.seat_index - right.seat_index)
    .map((player) => String(player.display_name).trim())
    .filter(Boolean)

  return names.length >= 3 ? names : PLAYER_NAMES
}

function getRestartPlayerNames(game, onlineSession) {
  if (onlineSession?.players?.length >= 3) {
    return getOnlinePlayerNames(onlineSession.players)
  }

  return game.players.map((player) => player.name)
}

function getLocalTestPlayerNames(playerCount) {
  return LOCAL_TEST_PLAYER_NAMES.slice(0, playerCount)
}

function getGameCommandErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : fallback

  if (/Unknown game command: (markArgumentComplete|forceCompleteArguments)/.test(message)) {
    return `${message}. Deploy the updated Supabase game-action Edge Function.`
  }

  return message
}

export function useGameActions({
  amountInput,
  ante,
  applyOnlineCommandResult,
  bigBlind,
  canResolveVotes,
  contenders,
  effectiveJudgeVote,
  effectivePlayerVotes,
  game,
  initialPulseTicks,
  isOnlinePlaying,
  isShowdownVoting,
  judge,
  localGame,
  localWordPack,
  myOnlineSeatIndex,
  onlineJudgeVoteValue,
  onlinePlayerVoteValue,
  onlineSession,
  playerVoteVoters,
  previousPhaseRef,
  roomId,
  setAmountInput,
  setErrorText,
  setJudgeVote,
  setLocalGame,
  setLocalWordPackId,
  setOnlineGameBusy,
  setOnlinePrivateDataKey,
  setOnlineVoteStatusRows,
  setPlayerVotes,
  setPulseTicks,
  setRevealByPlayerId,
  startingStack,
  userId,
}) {
  function resetHandInputs() {
    setAmountInput('')
    setPlayerVotes({})
    setJudgeVote('')
    setRevealByPlayerId({})
  }

  async function runAction(type, amountOverride) {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'playerAction',
          payload: {
            type,
            amount: amountOverride ?? Number(amountInput),
          },
        })
        applyOnlineCommandResult(result)

        const nextLegal = getLegalActions(result.roomState.state_json)
        if (nextLegal.raise) {
          setAmountInput(String(nextLegal.minRaiseTo))
        } else if (nextLegal.bet) {
          setAmountInput(String(nextLegal.minBetTo))
        }
      } else {
        const nextGame = applyPlayerAction(
          game,
          type,
          amountOverride ?? Number(amountInput),
        )
        setLocalGame(nextGame)

        const nextLegal = getLegalActions(nextGame)
        if (nextLegal.raise) {
          setAmountInput(String(nextLegal.minRaiseTo))
        } else if (nextLegal.bet) {
          setAmountInput(String(nextLegal.minBetTo))
        }
      }
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function beginNextHand() {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'startNextHand',
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = startNextHand(game)
        setLocalGame(nextGame)
      }
      setErrorText('')
      resetHandInputs()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not start next hand.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function startNewGame() {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'startNewGame',
          payload: {
            startingStack,
            ante,
            bigBlind,
          },
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = createInitialGame({
          playerNames: getRestartPlayerNames(game, onlineSession),
          startingStack,
          ante,
          bigBlind,
          wordPack: localWordPack,
        })
        setLocalGame(nextGame)
      }
      setErrorText('')
      resetHandInputs()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not start a new game.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  function restartLocalTestGame(playerCount, wordPack = localWordPack) {
    const nextGame = createInitialGame({
      playerNames: getLocalTestPlayerNames(playerCount),
      startingStack,
      ante,
      bigBlind,
      wordPack,
    })

    setLocalGame(nextGame)
    setAmountInput('')
    setErrorText('')
    setRevealByPlayerId({})
    setPlayerVotes({})
    setJudgeVote('')
    setPulseTicks(initialPulseTicks)
    previousPhaseRef.current = null
  }

  function handleSelectLocalWordPack(wordPackId) {
    const nextWordPack = getWordPackById(wordPackId)

    setLocalWordPackId(nextWordPack.id)
    restartLocalTestGame(localGame.players.length, nextWordPack)
  }

  async function resolveVotes() {
    try {
      if (isOnlinePlaying && !canResolveVotes) {
        setErrorText('Waiting for all showdown votes.')
        return
      }

      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'resolveVotes',
        })
        applyOnlineCommandResult(result)
      } else {
        const nextGame = resolveShowdownVotes(game, {
          playerVotes: effectivePlayerVotes,
          judgeVote: judge ? Number(effectiveJudgeVote) : null,
        })
        setLocalGame(nextGame)
      }
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Vote resolution failed.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function markArgument(playerId, phaseKey) {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'markArgumentComplete',
          payload: {
            playerId,
            phaseKey,
          },
        })
        applyOnlineCommandResult(result)
      } else {
        setLocalGame(markArgumentComplete(game, playerId, phaseKey))
      }

      setErrorText('')
    } catch (error) {
      setErrorText(getGameCommandErrorMessage(error, 'Could not mark argument complete.'))
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function forceCompleteArgumentPhase(phaseKey) {
    try {
      if (isOnlinePlaying) {
        setOnlineGameBusy(true)
        const result = await invokeGameCommand({
          roomId,
          command: 'forceCompleteArguments',
          payload: {
            phaseKey,
          },
        })
        applyOnlineCommandResult(result)
      } else {
        setLocalGame(forceCompleteArguments(game, phaseKey))
      }

      setErrorText('')
    } catch (error) {
      setErrorText(getGameCommandErrorMessage(error, 'Could not override arguments.'))
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function submitOnlinePlayerVote() {
    const selectedVote = onlinePlayerVoteValue
    const voterId = myOnlineSeatIndex
    const targetId = Number(selectedVote)

    if (!isOnlinePlaying || !isShowdownVoting || voterId === null) {
      return
    }

    const voter = playerVoteVoters.find((player) => player.id === voterId)

    if (!voter) {
      setErrorText('The Judge does not submit a Player Vote.')
      return
    }

    if (!contenders.some((player) => player.id === targetId)) {
      setErrorText('Choose a valid player vote before submitting.')
      return
    }

    if (contenders.some((player) => player.id === voterId) && targetId === voterId) {
      setErrorText('Choose another player. You cannot vote for your own word.')
      return
    }

    try {
      setOnlineGameBusy(true)
      await submitShowdownVote({
        roomId,
        handNumber: game.handNumber,
        voterPlayerId: voterId,
        voteType: 'player',
        targetPlayerId: targetId,
      })
      setOnlineVoteStatusRows((previous) => {
        const filtered = previous.filter((row) => {
          return !(row.vote_type === 'player' && Number(row.voter_player_id) === voterId)
        })

        return [
          ...filtered,
          {
            vote_type: 'player',
            voter_player_id: voterId,
            submitted: true,
          },
        ]
      })
      setOnlinePrivateDataKey(`${roomId}:${game.handNumber}`)
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to submit player vote.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function submitOnlineJudgeVote() {
    const targetId = Number(onlineJudgeVoteValue)

    if (!isOnlinePlaying || !isShowdownVoting || judge?.id !== myOnlineSeatIndex) {
      return
    }

    if (!contenders.some((player) => player.id === targetId)) {
      setErrorText('Choose a valid judge vote before submitting.')
      return
    }

    try {
      setOnlineGameBusy(true)
      await submitShowdownVote({
        roomId,
        handNumber: game.handNumber,
        voterPlayerId: myOnlineSeatIndex,
        voteType: 'judge',
        targetPlayerId: targetId,
      })
      setOnlineVoteStatusRows((previous) => {
        const filtered = previous.filter((row) => row.vote_type !== 'judge')

        return [
          ...filtered,
          {
            vote_type: 'judge',
            voter_player_id: myOnlineSeatIndex,
            submitted: true,
          },
        ]
      })
      setOnlinePrivateDataKey(`${roomId}:${game.handNumber}`)
      setErrorText('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to submit judge vote.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  async function handleStartOnlineGame() {
    if (!onlineSession?.room?.id || !userId) {
      setErrorText('Join a room before starting an online game.')
      return
    }

    if (onlineSession.room.host_user_id !== userId) {
      setErrorText('Only the room host can start the online game.')
      return
    }

    try {
      setOnlineGameBusy(true)
      const result = await invokeGameCommand({
        roomId,
        command: 'startGame',
        payload: {
          startingStack,
          ante,
          bigBlind,
        },
      })
      applyOnlineCommandResult(result)

      setErrorText('')
      resetHandInputs()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to start online game.')
    } finally {
      setOnlineGameBusy(false)
    }
  }

  return {
    beginNextHand,
    forceCompleteArgumentPhase,
    handleSelectLocalWordPack,
    handleStartOnlineGame,
    markArgument,
    resolveVotes,
    restartLocalTestGame,
    runAction,
    startNewGame,
    submitOnlineJudgeVote,
    submitOnlinePlayerVote,
  }
}
