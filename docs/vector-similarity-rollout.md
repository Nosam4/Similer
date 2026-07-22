# Vector Similarity Rollout

Multiplayer similarity is migrating from a precomputed all-pairs matrix to on-demand Judge-to-hand cosine scores in Supabase. Local/singleplayer remains independent of Supabase and continues using the frontend engine's stable placeholder scores.

## Current guarded behavior

The `game-action` Edge Function supports three `SIMILARITY_MODE` values:

- `prefer-database` (default): use a complete database score set; otherwise use the temporary matrix.
- `matrix-only`: emergency rollback that skips the database RPC.
- `database-only`: fail the online command if database scores are unavailable or incomplete. Use this only after production parity is established and before removing the matrix.

Database results are accepted only when every dealt player has one finite score. Partial results never mix with matrix values. The score map is transient server state and is removed before `room_states.state_json` is saved.

## Current 2,000-word catalog

The database contains 2,000 active `word2vec-google-news-300` embeddings. Live multiplayer uses `DEALING_MODE=database-only` and `SIMILARITY_MODE=database-only`, so new hands are transactionally dealt from the full catalog and scored only in the database. Local/singleplayer is unchanged, and the original 100-word dealer remains available as a server-side rollback path.

The canonical spellings are tracked in `word-packs/multiplayer-2000.txt`. The catalog:

- preserves all 100 original words so active games and matrix fallback remain compatible;
- includes 489 of the 492 unique words across the everyday, party, legal, sports, and food packs;
- omits `nacho`, `queso`, and `selfie` because the lowercase tokens are absent from the selected embedding model;
- fills the remaining slots deterministically from reviewed frequency bands in the local Google News Word2Vec vocabulary and system dictionary;
- applies the human-readable rejection list in `word-packs/multiplayer-exclusions.txt` to generated filler;
- contains exactly 2,000 unique lowercase words, each with one normalized 300-dimensional vector.

The current catalog SHA-256 is `72021326039d6b9021f37fd7ad666567e5c09bd0ea2f6f59220d29652f31661c`.

Regenerate and audit the tracked list with:

```bash
.venv-wordgen/bin/python scripts/generate_multiplayer_catalog.py
.venv-wordgen/bin/python scripts/audit_multiplayer_catalog.py
```

## Stage 1: Apply the additive migration

Apply migrations through the project's normal Supabase migration workflow. The migration `20260722120000_vector_similarity_catalog.sql`:

- enables `vector` in the `extensions` schema;
- creates the server-only `private.word_catalog` with 300-dimensional vectors;
- creates service-role-only import, status, and hand-scoring RPCs;
- grants no browser role access to the embeddings or RPCs.

This migration does not change dealing, the frontend, existing hand rows, or the fallback matrix.

## Stage 2: Export embeddings

Create a local Python environment and install the existing generation dependencies:

```bash
python3 -m venv .venv-wordgen
.venv-wordgen/bin/pip install -r scripts/requirements-wordgen.txt
```

Export normalized vectors for the tracked 2,000-word catalog:

```bash
.venv-wordgen/bin/python scripts/export_word_embeddings.py \
  --words word-packs/multiplayer-2000.txt \
  --limit 200000 \
  --output supabase/.private/word-embeddings-2000.json
```

The output directory is ignored by Git because embeddings are a server-only answer key.

## Stage 3: Verify local parity

Compare all 10,000 existing matrix cells with cosine scores calculated from the exported vectors:

```bash
.venv-wordgen/bin/python scripts/verify_word_embedding_parity.py \
  --embeddings supabase/.private/word-embeddings-2000.json
```

The importer and migration both require 300-dimensional normalized vectors. Do not import embeddings from a different model version into the same catalog without first measuring gameplay and score-distribution changes.

## Stage 4: Import into Supabase

After the migration is live, provide server-only credentials in the shell—not in a `VITE_` variable or browser environment—and run:

```bash
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="SERVICE_ROLE_KEY" \
node scripts/import_word_embeddings.mjs supabase/.private/word-embeddings-2000.json
```

The importer batches service-role-only `upsert_word_embeddings` RPC calls, then prints catalog counts. It is safe to rerun because words are upserted by normalized spelling.

## Stage 5: Deploy and observe guarded scoring

Deploy `game-action` only after both the migration and the 100-word import succeed. Leave `SIMILARITY_MODE` unset or set it to `prefer-database`.

Verify normal Judge voting, tied Player Votes, folded players, neutral all-in voting, two-player similarity duels, and side pots. Edge Function logs should not contain database-fallback warnings once all current words are imported.

Run the non-mutating live catalog and pair-scoring check with the same server-only shell variables:

```bash
EXPECTED_WORD_CATALOG_SIZE=2000 node scripts/verify_live_vector_rollout.mjs
```

For immediate rollback, configure `SIMILARITY_MODE=matrix-only` and redeploy/restart the function as required by the Supabase environment. This changes only the multiplayer score source.

## Stage 6: Expand the pool and move dealing

The additive catalog-dealing migration and guarded Edge Function now:

1. Attach catalog word IDs and a deal version to private hand assignments while retaining the text snapshot used by the UI.
2. Record per-room, per-cycle usage so words do not repeat within a cycle; a fresh cycle begins when the remaining unused words cannot fill a complete hand plus its neutral reservation.
3. Select words, reserve the neutral word, replace private rows, clear votes, and compare-and-swap the room state in one transaction.
4. Treat retries for the same target state version as idempotent.
5. Keep the neutral reservation private until the backend engine actually needs a neutral Judge.
6. Hydrate catalog assignments into the synchronous backend engine without exposing them in public room state.
7. Fail catalog-dealt hands closed if database similarity is unavailable instead of consulting the 100-word matrix.

The live feature flag supports:

- `legacy-only`: new multiplayer hands use the original matrix-backed 100-word dealer.
- `database-only` (currently active): new multiplayer hands use the 2,000-word transactional catalog dealer.

Run the rollback-only live database verification before activation:

```bash
set -a
source ./.env.supabase.local
set +a
.venv-wordgen/bin/python scripts/verify_live_catalog_dealing.py
```

The verifier creates two hands inside one database transaction, checks atomic persistence, retry idempotency, neutral reservation, cycle uniqueness, and browser-role denial, and then always rolls the transaction back.

After activation, run the public-API and Edge Function lifecycle verification:

```bash
set -a
source ./.env.supabase.local
source ./.env.local
set +a
node scripts/verify_live_game_action_catalog_dealing.mjs
```

This creates three temporary anonymous users and a room through the same APIs as the frontend. It completes betting, Judge reveal, database scoring, arguments, voting, payout, and a second deal; verifies word privacy and cycle uniqueness; then deletes the temporary room and users.

For a guarded activation, set both server-only modes:

```bash
supabase secrets set \
  DEALING_MODE=database-only \
  SIMILARITY_MODE=database-only \
  --project-ref yvltpqzlcbcdrtchnfrb
```

To stop new catalog deals immediately:

```bash
supabase secrets set \
  DEALING_MODE=legacy-only \
  --project-ref yvltpqzlcbcdrtchnfrb
```

Already-running catalog hands continue loading their database assignments and reserved neutral word; keep database similarity enabled until those hands finish. Do not switch `SIMILARITY_MODE` to `matrix-only` while any catalog-dealt hand is active. After they finish, `SIMILARITY_MODE=prefer-database` restores the guarded matrix fallback for subsequent legacy hands.

The neutral reservation is necessary because final-duel and protected-all-in transitions currently select a neutral word synchronously inside the backend engine.

## Stage 7: Remove the matrix

After database scoring and database dealing have both run without fallbacks:

1. Set `SIMILARITY_MODE=database-only`.
2. Confirm missing/inactive embedding tests fail closed.
3. Remove the matrix import, matrix lookup, generation path, and deployment requirement from the backend.
4. Keep local/singleplayer's placeholder scoring unchanged.
5. Remove `matrix-only` and `prefer-database` modes after an appropriate rollback window.
