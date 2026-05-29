# Similer: Word Judge Poker

A poker-style social word game using a fixed 100-word similarity matrix.

## Core idea

Each active player gets one hidden **WORD** (their hole card).
After preflop betting, one player becomes the **Judge** and reveals their word.
Remaining contenders bet once more, then showdown is decided by three categories:

1. `player vote` (contenders vote)
2. `judge vote` (judge selects best connection)
3. `similarity score` (matrix value against judge word)

A player wins by taking `2/3` or `3/3` categories.
If categories split across different players, similarity is used as the final tiebreak.

## Judge incentive

- Judge is inactive after the flop (postflop) phase starts.
- Judge contribution remains at risk in the pot.
- If the judge vote matches the final winner, judge receives:
  - their contribution back
  - plus `5%` of total pot (integer chips via floor)

## Round flow

1. New hand starts, words are dealt privately.
2. Preflop betting (fold/check/call/bet/raise/all-in).
3. Judge assigned (left of dealer among remaining players); judge word is revealed.
4. Single postflop betting round (judge cannot act).
5. If only one contender remains, they win uncontested.
6. Otherwise showdown voting resolves winner and payouts.

## Matrix source

- Source file: `2818_(2)randomizedwords_matrix1.xlsx`
- App runtime file: `src/wordgame/matrix.json`
- Matrix size: `100 x 100`

## Run locally

```bash
npm install
npm run dev
```

Then open the Vite local URL.

## Multiplayer foundation (Supabase)

This project now includes a Phase 1 multiplayer room system:

- anonymous auth session bootstrap
- create/join 4-player rooms by code
- live seat + ready-state sync
- SQL schema for rooms, players, room state, and action history

### 1. Set local env vars

Create a `.env.local` file (or copy `.env.example`) and set:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

### 2. Apply the SQL migration in Supabase

Run the SQL in:

- `supabase/migrations/20260529120000_multiplayer_rooms.sql`

This creates:

- `rooms`
- `room_players`
- `room_states`
- `room_actions`
- RPC functions: `create_room`, `join_room`, `leave_room`
- RLS policies for member-scoped access

### 3. Enable anonymous sign-ins

In Supabase Auth, enable anonymous sign-ins so room guests can connect without full account signup.

### 4. Start app

```bash
npm run dev
```

Room UI appears in the app at the top in `Online Multiplayer (Supabase Rooms)`.
Gameplay is still local-state today; shared turn/action sync is the next phase.

## Implementation files

- App UI: `src/App.jsx`
- Styling: `src/App.css`
- Game engine: `src/wordgame/engine.js`
- Similarity matrix data: `src/wordgame/matrix.json`
- Room lobby UI: `src/components/OnlineRoomPanel.jsx`
- Supabase client: `src/lib/supabaseClient.js`
- Room APIs: `src/multiplayer/roomApi.js`
- SQL migration: `supabase/migrations/20260529120000_multiplayer_rooms.sql`
