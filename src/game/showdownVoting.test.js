import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDefaultPlayerVotes,
  canResolveShowdownVotes,
  countSubmittedPlayerVotes,
  getEffectiveJudgeVote,
  getEffectivePlayerVotes,
  isValidPlayerVote,
} from './showdownVoting.js'

const contenders = [
  { id: 0, name: 'North' },
  { id: 1, name: 'East' },
  { id: 2, name: 'South' },
]
const playerVoteVoters = [
  { id: 0, name: 'North' },
  { id: 1, name: 'East' },
  { id: 3, name: 'West' },
]

describe('showdown voting helpers', () => {
  it('builds local default votes without assigning self votes', () => {
    assert.deepEqual(
      buildDefaultPlayerVotes({
        isShowdownVoting: true,
        contenders,
        playerVoteVoters,
      }),
      {
        0: '1',
        1: '0',
        3: '0',
      },
    )
  })

  it('does not default votes outside showdown voting', () => {
    assert.deepEqual(
      buildDefaultPlayerVotes({
        isShowdownVoting: false,
        contenders,
        playerVoteVoters,
      }),
      {},
    )
  })

  it('uses explicit local votes but hides effective votes online', () => {
    assert.deepEqual(
      getEffectivePlayerVotes({
        isOnlinePlaying: false,
        playerVotes: {},
        defaultPlayerVotes: { 0: '1' },
      }),
      { 0: '1' },
    )

    assert.deepEqual(
      getEffectivePlayerVotes({
        isOnlinePlaying: false,
        playerVotes: { 0: '2' },
        defaultPlayerVotes: { 0: '1' },
      }),
      { 0: '2' },
    )

    assert.deepEqual(
      getEffectivePlayerVotes({
        isOnlinePlaying: true,
        playerVotes: { 0: '2' },
        defaultPlayerVotes: { 0: '1' },
      }),
      {},
    )
  })

  it('defaults the local judge vote to the first contender only when a judge exists', () => {
    assert.equal(
      getEffectiveJudgeVote({
        judge: { id: 4 },
        isOnlinePlaying: false,
        judgeVote: '',
        contenders,
      }),
      '0',
    )
    assert.equal(
      getEffectiveJudgeVote({
        judge: { id: 4 },
        isOnlinePlaying: true,
        judgeVote: '2',
        contenders,
      }),
      '',
    )
    assert.equal(
      getEffectiveJudgeVote({
        judge: null,
        isOnlinePlaying: false,
        judgeVote: '2',
        contenders,
      }),
      '',
    )
  })

  it('validates player votes against contender targets and self-votes', () => {
    assert.equal(isValidPlayerVote({ voterId: 0, value: '1', contenders }), true)
    assert.equal(isValidPlayerVote({ voterId: 0, value: '0', contenders }), false)
    assert.equal(isValidPlayerVote({ voterId: 0, value: '9', contenders }), false)
    assert.equal(isValidPlayerVote({ voterId: 0, value: '', contenders }), false)
    assert.equal(isValidPlayerVote({ voterId: 0, value: null, contenders }), false)
  })

  it('counts local valid player votes and online submitted player votes', () => {
    assert.equal(
      countSubmittedPlayerVotes({
        isOnlinePlaying: false,
        playerVoteVoters,
        onlineSubmittedPlayerVoteIds: [],
        effectivePlayerVotes: {
          0: '1',
          1: '1',
          3: '2',
        },
        contenders,
      }),
      2,
    )

    assert.equal(
      countSubmittedPlayerVotes({
        isOnlinePlaying: true,
        playerVoteVoters,
        onlineSubmittedPlayerVoteIds: [1, 3, 7],
        effectivePlayerVotes: {},
        contenders,
      }),
      2,
    )
  })

  it('requires all local votes and judge vote before resolution', () => {
    assert.equal(
      canResolveShowdownVotes({
        isShowdownVoting: true,
        contenders,
        isOnlinePlaying: false,
        submittedPlayerVoteCount: 0,
        playerVoteVoters,
        judgeVoteSubmitted: true,
        effectivePlayerVotes: {
          0: '1',
          1: '0',
          3: '2',
        },
        judge: { id: 4 },
        effectiveJudgeVote: '1',
      }),
      true,
    )

    assert.equal(
      canResolveShowdownVotes({
        isShowdownVoting: true,
        contenders,
        isOnlinePlaying: false,
        submittedPlayerVoteCount: 0,
        playerVoteVoters,
        judgeVoteSubmitted: true,
        effectivePlayerVotes: {
          0: '0',
          1: '0',
          3: '2',
        },
        judge: { id: 4 },
        effectiveJudgeVote: '1',
      }),
      false,
    )
  })

  it('requires all online player vote statuses and the judge vote before resolution', () => {
    assert.equal(
      canResolveShowdownVotes({
        isShowdownVoting: true,
        contenders,
        isOnlinePlaying: true,
        submittedPlayerVoteCount: 3,
        playerVoteVoters,
        judgeVoteSubmitted: true,
        effectivePlayerVotes: {},
        judge: { id: 4 },
        effectiveJudgeVote: '',
      }),
      true,
    )

    assert.equal(
      canResolveShowdownVotes({
        isShowdownVoting: true,
        contenders,
        isOnlinePlaying: true,
        submittedPlayerVoteCount: 2,
        playerVoteVoters,
        judgeVoteSubmitted: true,
        effectivePlayerVotes: {},
        judge: { id: 4 },
        effectiveJudgeVote: '',
      }),
      false,
    )
  })
})
