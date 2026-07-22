# Similer: Word Judge Poker

A poker-style social word game where hidden words, table talk, player voting, judge voting, and semantic similarity decide each hand.

## Core Idea

Each active player receives one hidden word, similar to a poker hole card. Players bet, a Judge word becomes live, contenders debate whose word connects most closely to the Judge word, and the hand resolves through voting plus backend similarity scoring.

## Round Flow

1. A new hand starts and active players receive private words.
2. Preflop betting begins with small blind and big blind posting.
3. A Judge phase starts after preflop betting resolves.
4. The Judge word is revealed, and the Judge does not act in later betting.
5. A postflop betting round occurs with the Judge word live.
6. Contenders enter the Debate Stage and argue why their word is closest.
7. Showdown Voting collects player votes and, when applicable, the Judge vote.
8. The Supabase Edge Function resolves payouts, Judge Tax, side pots, and the next state.

## Showdown Logic

Most hands use three categories:

1. `Player Vote`
2. `Judge Vote`
3. `Similarity`

A contender wins by taking at least two categories. If category wins split, similarity breaks the tie.

Special cases:

- Two-player final duels use a neutral Judge word and similarity decides the winner.
- Neutral all-in showdowns use player votes first; a clear majority wins, otherwise similarity decides.
- Side pots are awarded only among players eligible for that specific pot layer.

## Judge Incentive

The Judge is inactive after becoming Judge.

Current Judge payout rules:

- An active Judge receives their covered stake back when the hand ends.
- An active Judge earns a 20% Judge Tax if their Judge vote matches the main hand winner.
- A folded Judge does not receive a stake refund.
- A folded Judge earns a reduced 10% Judge Tax if their Judge vote matches the main hand winner.
- Judge Tax can only be taken from pot layers the Judge contributed to.
- No Judge can tax uncovered side pots above their committed stake.

## Words And Similarity

The frontend/local game uses `src/wordgame/wordBank.json` for fast single-device playtesting. It does not query Supabase for words or similarity; local similarity remains a stable placeholder.

Online similarity scoring is backend-authoritative:

- Supabase pgvector currently stores 2,000 private normalized word embeddings.
- The `game-action` Edge Function requests only Judge-to-hand scores and never publishes the private score map before showdown.
- During the safe rollout, `SIMILARITY_MODE=prefer-database` uses the existing matrix only when the database RPC is unavailable or incomplete.
- The temporary matrix remains at `supabase/functions/_shared/wordgame/matrix.json` and is intentionally ignored by Git.
- Transactional database dealing, per-room shuffle cycles, and one private neutral Judge-word reservation per hand are installed behind `DEALING_MODE`.
- Live multiplayer now uses `DEALING_MODE=database-only` and `SIMILARITY_MODE=database-only`, so new hands are dealt from the 2,000-word catalog.
- The original 100-word dealer remains available through `DEALING_MODE=legacy-only` as the immediate rollback path.
- Catalog-dealt hands fail closed if database similarity is unavailable; they can never fall back to the incompatible 100-word matrix.

The tracked multiplayer catalog is `word-packs/multiplayer-2000.txt`. Its reproducible generation and validation utilities are:

- `scripts/generate_multiplayer_catalog.py`
- `scripts/audit_multiplayer_catalog.py`
- `scripts/generate_word_matrix.py`
- `scripts/export_word_embeddings.py`
- `scripts/import_word_embeddings.mjs`
- `scripts/verify_live_catalog_dealing.py`
- `scripts/verify_live_game_action_catalog_dealing.mjs`
- `scripts/verify_word_embedding_parity.py`
- `scripts/requirements-wordgen.txt`

See `docs/vector-similarity-rollout.md` for migration, import, verification, rollback, and eventual matrix-removal steps.

## Multiplayer

Similer supports Supabase rooms with up to 8 players.

The online flow includes:

- Anonymous Supabase auth.
- Create and join rooms by code.
- Live seat and ready-state sync.
- Server-authoritative gameplay actions through the `game-action` Edge Function.
- Private hand words stored separately from public room state.
- Showdown vote status sync without exposing vote targets early.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example` and set:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Run locally:

```bash
npm run dev
```

## Supabase Setup

Apply migrations in order from `supabase/migrations/`.

Deploy the Edge Function after changing server-side game logic:

```bash
supabase functions deploy game-action --project-ref yvltpqzlcbcdrtchnfrb
```

During the guarded rollout, the server-only fallback matrix must exist locally at:

```text
supabase/functions/_shared/wordgame/matrix.json
```

## GitHub Pages

The Vite production base path is `/Similer/`, configured in `vite.config.js`.

GitHub Pages deploys through `.github/workflows/deploy.yml`.

## Important Files

- `src/App.jsx`: main app flow and online/offline state wiring.
- `src/App.css`: table styling, pulses, confetti layer, and stage overlay styling.
- `src/components/`: UI panels and table components.
- `src/wordgame/engine.js`: local/demo game engine and shared frontend helpers.
- `src/wordgame/wordBank.json`: frontend-visible word bank.
- `src/multiplayer/roomApi.js`: Supabase room and online command APIs.
- `src/multiplayer/privateGameState.js`: private word/vote hydration helpers for the frontend.
- `supabase/functions/game-action/index.ts`: server-authoritative online gameplay endpoint.
- `supabase/functions/_shared/wordgame/engine.js`: backend game engine used by the Edge Function.
- `supabase/migrations/`: database schema, RLS, RPC, and permission migrations.
