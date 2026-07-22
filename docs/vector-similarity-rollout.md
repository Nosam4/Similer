# Database-Only Multiplayer Words And Similarity

Multiplayer now deals words and calculates similarity exclusively in Supabase. The former server-side all-pairs matrix, 100-word dealer, and their runtime rollback modes have been removed. Local/singleplayer remains independent of Supabase and continues using the frontend engine's stable placeholder scores.

## Production architecture

- `private.word_catalog` stores 2,000 active normalized `word2vec-google-news-300` embeddings.
- `public.deal_catalog_hand` transactionally selects player words, reserves one neutral Judge word, clears prior votes, and compare-and-swaps the public room state.
- `private.room_word_cycle_usage` tracks each room's shuffle cycle so words do not repeat before the remaining pool can no longer fill a complete hand plus its neutral reservation.
- `private.hand_neutral_words` keeps each neutral Judge word private until the server engine needs it.
- `public.score_hand_word_similarities` calculates only Judge-to-hand cosine similarities.
- The Edge Function accepts a score set only when every dealt player has one finite result. Missing or partial database data rejects the resolving command without advancing the room.
- The transient score map is removed before `room_states.state_json` is saved; final public showdown data contains only the completed score report.

No `DEALING_MODE` or `SIMILARITY_MODE` setting is used. New multiplayer hands always use database catalog dealing, and contested showdowns always require database scores.

## Catalog source and generation

The canonical list is `word-packs/multiplayer-2000.txt`. It contains exactly 2,000 unique lowercase words with one normalized 300-dimensional vector each. Its current SHA-256 is `72021326039d6b9021f37fd7ad666567e5c09bd0ea2f6f59220d29652f31661c`.

Regenerate and audit the tracked list with:

```bash
.venv-wordgen/bin/python scripts/generate_multiplayer_catalog.py
.venv-wordgen/bin/python scripts/audit_multiplayer_catalog.py
```

Export normalized vectors with:

```bash
.venv-wordgen/bin/python scripts/export_word_embeddings.py \
  --words word-packs/multiplayer-2000.txt \
  --limit 200000 \
  --output supabase/.private/word-embeddings-2000.json
```

The output directory is ignored by Git because embeddings are server-only data.

## Import and status verification

After applying the migrations, import with server-only credentials:

```bash
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="SERVICE_ROLE_KEY" \
node scripts/import_word_embeddings.mjs supabase/.private/word-embeddings-2000.json
```

The importer batches service-role-only upserts and prints catalog counts. It is safe to rerun because words are keyed by normalized spelling.

Run the non-mutating catalog and pair-scoring check with:

```bash
EXPECTED_WORD_CATALOG_SIZE=2000 node scripts/verify_live_vector_rollout.mjs
```

## Live lifecycle verification

Run the complete public-API and Edge Function test with:

```bash
set -a
source ./.env.supabase.local
source ./.env.local
set +a
node scripts/verify_live_game_action_catalog_dealing.mjs
```

The verifier creates three temporary anonymous users and a room through the frontend-facing APIs. It checks private catalog dealing, Judge reveal privacy, finite database scores in the final report, betting, arguments, voting, payout, idempotent action replay, and a second non-repeating deal. It then removes the temporary room and users.

The lower-level transactional verifier remains available:

```bash
set -a
source ./.env.supabase.local
set +a
.venv-wordgen/bin/python scripts/verify_live_catalog_dealing.py
```

It exercises two catalog deals inside a transaction and always rolls the transaction back.

## Failure behavior

Catalog dealing, neutral Judge reservation, and contested similarity scoring are required multiplayer dependencies. If any returns missing or incomplete data, the Edge Function rejects that command and preserves the current room version. Recovery is to repair the database dependency and retry the same idempotent command; there is no multiplayer matrix fallback.
