import BustedPanel from '../BustedPanel'
import DebatePanel from '../DebatePanel'
import HandCompletePanel from '../HandCompletePanel'
import ShowdownVotingPanel from '../ShowdownVotingPanel'
import TurnPanel from '../TurnPanel'

function GameActionPanel({
  actor,
  amountInput,
  canResolveVotes,
  contenders,
  defaultPlayerVotes,
  effectiveJudgeVote,
  effectivePlayerVotes,
  game,
  isBustedOnline,
  isDebate,
  isFinalDuel,
  isMyTurnOnline,
  isNeutralVoting,
  isOnlineHost,
  isOnlinePlaying,
  isOnlineWaiting,
  isShowdownVoting,
  judge,
  judgeVoteSubmitted,
  judgeWord,
  legal,
  myOnlinePlayer,
  myOnlineSeatIndex,
  onBeginNextHand,
  onRefreshOnlineVotes,
  onResolveVotes,
  onRunAction,
  onStartNewGame,
  onSubmitOnlineJudgeVote,
  onSubmitOnlinePlayerVote,
  onTurnWait,
  onlineGameBusy,
  onlineJudgeVoteValue,
  onlinePlayerVoteValue,
  onlineSubmittedPlayerVoteIds,
  onlineWaitingCopy,
  playerVoteVoters,
  potSummary,
  pulseTicks,
  setAmountInput,
  setJudgeVote,
  setPlayerVotes,
  submittedPlayerVoteCount,
  visibleErrorText,
}) {
  return (
    <section className="controls local-game-controls">
      {isOnlineWaiting ? (
        <>
          <div className="notice">
            <p>{onlineWaitingCopy}</p>
          </div>

          {visibleErrorText ? <p className="error-text">{visibleErrorText}</p> : null}
        </>
      ) : (
        <>
          {game.tableComplete ? (
            <div className="notice">
              <p>Table over: only one player has chips remaining.</p>
            </div>
          ) : null}

          {isOnlinePlaying && isBustedOnline && !game.handComplete && !isDebate && !isShowdownVoting ? (
            <BustedPanel playerName={myOnlinePlayer?.name} />
          ) : game.handComplete ? (
            <HandCompletePanel
              game={game}
              onBeginNextHand={onBeginNextHand}
              onStartNewGame={onStartNewGame}
              actionDisabled={isOnlinePlaying ? onlineGameBusy || !isOnlineHost : false}
              pulseTick={pulseTicks.handPanel}
              winnerPulseTick={pulseTicks.winnerLine}
            />
          ) : isDebate ? (
            <DebatePanel
              judge={judge}
              judgeWord={judgeWord}
              contenders={contenders}
              isFinalDuel={isFinalDuel}
              isNeutralVoting={isNeutralVoting}
              pulseTick={pulseTicks.debatePanel}
            />
          ) : isShowdownVoting ? (
            <ShowdownVotingPanel
              judge={judge}
              judgeWord={judgeWord}
              contenders={contenders}
              playerVoteVoters={playerVoteVoters}
              defaultPlayerVotes={defaultPlayerVotes}
              effectivePlayerVotes={effectivePlayerVotes}
              setPlayerVotes={setPlayerVotes}
              effectiveJudgeVote={effectiveJudgeVote}
              setJudgeVote={setJudgeVote}
              canResolveVotes={canResolveVotes}
              onResolveVotes={onResolveVotes}
              isOnlineHost={isOnlineHost}
              onRefreshOnlineVotes={onRefreshOnlineVotes}
              onRestartOnlineGame={onStartNewGame}
              pulseTick={pulseTicks.showdownPanel}
              isOnlinePlaying={isOnlinePlaying}
              myPlayerId={isOnlinePlaying ? myOnlineSeatIndex : null}
              submittedPlayerVoteIds={onlineSubmittedPlayerVoteIds}
              submittedPlayerVoteCount={submittedPlayerVoteCount}
              judgeVoteSubmitted={judgeVoteSubmitted}
              usesJudgeVote={Boolean(judge)}
              onlineGameBusy={isOnlinePlaying ? onlineGameBusy : false}
              onlinePlayerVoteValue={onlinePlayerVoteValue}
              setOnlinePlayerVoteValue={(nextValue) => {
                setPlayerVotes((previous) => ({
                  ...previous,
                  [myOnlineSeatIndex]: nextValue,
                }))
              }}
              onSubmitOnlinePlayerVote={onSubmitOnlinePlayerVote}
              onlineJudgeVoteValue={onlineJudgeVoteValue}
              setOnlineJudgeVoteValue={setJudgeVote}
              onSubmitOnlineJudgeVote={onSubmitOnlineJudgeVote}
            />
          ) : (
            <TurnPanel
              actor={actor}
              busy={isOnlinePlaying ? onlineGameBusy : false}
              legal={legal}
              potSummary={potSummary}
              amountInput={amountInput}
              setAmountInput={setAmountInput}
              onRunAction={(type, amountOverride) => {
                if (isOnlinePlaying && !isMyTurnOnline) {
                  onTurnWait?.()
                  return
                }

                onRunAction(type, amountOverride)
              }}
              pulseTick={pulseTicks.turnPanel}
            />
          )}

          {visibleErrorText ? <p className="error-text">{visibleErrorText}</p> : null}
        </>
      )}
    </section>
  )
}

export default GameActionPanel
