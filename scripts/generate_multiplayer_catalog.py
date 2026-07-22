#!/usr/bin/env python3
"""Build the tracked 2,000-word multiplayer catalog deterministically."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from gensim.models import KeyedVectors

from word_catalog_filters import BLOCKLIST, STOPWORDS, WORD_PATTERN, is_playable_word


DEFAULT_MODEL_PATH = Path("~/Downloads/word2vec-google-news-300.gz").expanduser()
DEFAULT_REQUIRED_PATH = Path("src/wordgame/wordBank.json")
DEFAULT_OUTPUT_PATH = Path("word-packs/multiplayer-2000.txt")
DEFAULT_DICTIONARY_PATH = Path("/usr/share/dict/words")
DEFAULT_EXCLUSIONS_PATH = Path("word-packs/multiplayer-exclusions.txt")
PREFERRED_PACK_PATHS = (
    Path("word-packs/everyday.txt"),
    Path("word-packs/party.txt"),
    Path("word-packs/legal.txt"),
    Path("word-packs/sports.txt"),
    Path("word-packs/food.txt"),
)
RANK_BUCKETS = (
    (500, 5000, 0.40),
    (5000, 12000, 0.35),
    (12000, 30000, 0.25),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a deterministic, filtered multiplayer word catalog.",
    )
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--required", type=Path, default=DEFAULT_REQUIRED_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_DICTIONARY_PATH)
    parser.add_argument("--exclusions", type=Path, default=DEFAULT_EXCLUSIONS_PATH)
    parser.add_argument("--word-count", type=int, default=2000)
    parser.add_argument("--limit", type=int, default=200000)
    parser.add_argument("--seed", type=int, default=20260722)
    return parser.parse_args()


def read_word_file(path: Path) -> list[str]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        raw_words = data.get("words") if isinstance(data, dict) else data
        if not isinstance(raw_words, list):
            raise ValueError(f"{path} must contain a JSON array or a 'words' array.")
    else:
        raw_words = [
            line
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]

    return list(
        dict.fromkeys(
            str(word).strip().lower()
            for word in raw_words
            if str(word).strip()
        ),
    )


def load_lowercase_dictionary(path: Path) -> set[str]:
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines()
        if line.strip() and line.strip() == line.strip().lower()
    }


def is_catalog_candidate(
    word: str,
    dictionary_words: set[str],
    catalog_exclusions: set[str],
) -> bool:
    return (
        word in dictionary_words
        and word not in STOPWORDS
        and word not in BLOCKLIST
        and word not in catalog_exclusions
        and not word.endswith("s")
        and is_playable_word(word)
    )


def take_bucket_sample(
    candidates: list[str],
    desired_count: int,
    rng: random.Random,
) -> list[str]:
    if desired_count <= 0:
        return []
    if len(candidates) <= desired_count:
        return candidates
    return rng.sample(candidates, desired_count)


def main() -> None:
    args = parse_args()
    if args.word_count < 100:
        raise ValueError("Catalog must contain at least 100 words.")

    required_words = read_word_file(args.required)
    preferred_words = list(
        dict.fromkeys(
            word
            for pack_path in PREFERRED_PACK_PATHS
            for word in read_word_file(pack_path)
        ),
    )
    dictionary_words = load_lowercase_dictionary(args.dictionary)
    catalog_exclusions = set(read_word_file(args.exclusions))

    print(f"Loading up to {args.limit:,} vectors from {args.model.expanduser()}")
    model = KeyedVectors.load_word2vec_format(
        str(args.model.expanduser()),
        binary=True,
        limit=args.limit,
    )

    missing_required = [word for word in required_words if word not in model]
    if missing_required:
        raise ValueError("Required words missing from model: " + ", ".join(missing_required))

    invalid_required = [word for word in required_words if not WORD_PATTERN.fullmatch(word)]
    if invalid_required:
        raise ValueError("Required words have invalid spelling: " + ", ".join(invalid_required))

    accepted_preferred = [
        word
        for word in preferred_words
        if word in model
        and WORD_PATTERN.fullmatch(word)
        and word not in BLOCKLIST
        and word not in STOPWORDS
    ]
    skipped_preferred = [word for word in preferred_words if word not in accepted_preferred]

    selected = list(dict.fromkeys([*required_words, *accepted_preferred]))
    selected_set = set(selected)
    remaining_count = args.word_count - len(selected)
    if remaining_count < 0:
        raise ValueError("Required and preferred words exceed the requested catalog size.")

    rng = random.Random(args.seed)
    bucket_samples: list[str] = []
    allocated_count = 0

    for bucket_index, (start, end, share) in enumerate(RANK_BUCKETS):
        bucket = [
            word
            for word in model.index_to_key[start:min(end, len(model.index_to_key))]
            if word not in selected_set
            and is_catalog_candidate(word, dictionary_words, catalog_exclusions)
        ]
        desired_count = (
            remaining_count - allocated_count
            if bucket_index == len(RANK_BUCKETS) - 1
            else round(remaining_count * share)
        )
        sample = take_bucket_sample(bucket, desired_count, rng)
        bucket_samples.extend(sample)
        selected_set.update(sample)
        allocated_count += len(sample)

    if len(bucket_samples) < remaining_count:
        all_candidates = [
            word
            for word in model.index_to_key[RANK_BUCKETS[0][0]:RANK_BUCKETS[-1][1]]
            if word not in selected_set
            and is_catalog_candidate(word, dictionary_words, catalog_exclusions)
        ]
        extra = take_bucket_sample(all_candidates, remaining_count - len(bucket_samples), rng)
        bucket_samples.extend(extra)

    final_words = sorted(dict.fromkeys([*selected, *bucket_samples]))
    if len(final_words) != args.word_count:
        raise ValueError(
            f"Generated {len(final_words)} unique words; expected {args.word_count}.",
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(final_words) + "\n", encoding="utf-8")

    print(f"Wrote {len(final_words):,} words to {args.output}")
    print(f"Preserved required words: {len(required_words):,}")
    print(f"Included preferred pack words: {len(accepted_preferred):,}/{len(preferred_words):,}")
    if skipped_preferred:
        print("Skipped preferred words without an acceptable model entry: " + ", ".join(skipped_preferred))


if __name__ == "__main__":
    main()
