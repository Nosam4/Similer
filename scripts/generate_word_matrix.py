#!/usr/bin/env python3
"""Generate a Similer word matrix from a local Word2Vec model."""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

import numpy as np
from gensim.models import KeyedVectors


DEFAULT_MODEL_PATH = Path("~/Downloads/word2vec-google-news-300.gz").expanduser()
DEFAULT_OUTPUT_PATH = Path("src/wordgame/matrix.json")
WORD_PATTERN = re.compile(r"^[a-z]{3,10}$")

STOPWORDS = {
    "about",
    "above",
    "after",
    "again",
    "against",
    "also",
    "among",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "cannot",
    "could",
    "does",
    "doing",
    "down",
    "during",
    "each",
    "from",
    "further",
    "had",
    "has",
    "have",
    "having",
    "here",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "into",
    "itself",
    "just",
    "more",
    "most",
    "nor",
    "not",
    "off",
    "once",
    "only",
    "other",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "same",
    "she",
    "should",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "too",
    "under",
    "until",
    "very",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
}

BLOCKLIST = {
    "abuse",
    "addict",
    "adolf",
    "bomb",
    "cancer",
    "corpse",
    "crack",
    "death",
    "drug",
    "drugs",
    "genocide",
    "heroin",
    "hitler",
    "murder",
    "nazi",
    "opium",
    "porn",
    "racism",
    "reais",
    "repo",
    "rape",
    "slavery",
    "slur",
    "suicide",
    "terror",
    "weapon",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build src/wordgame/matrix.json from Word2Vec similarities.",
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help=f"Path to Google News Word2Vec .gz file. Default: {DEFAULT_MODEL_PATH}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Matrix JSON output path. Default: {DEFAULT_OUTPUT_PATH}",
    )
    parser.add_argument(
        "--words",
        type=Path,
        default=None,
        help="Optional newline-delimited word list to use instead of random sampling.",
    )
    parser.add_argument(
        "--word-count",
        type=int,
        default=100,
        help="Number of words to sample when --words is not provided.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50000,
        help="Load only this many vectors from the model to reduce memory use.",
    )
    parser.add_argument(
        "--min-rank",
        type=int,
        default=500,
        help="Skip the most frequent N model entries when random sampling.",
    )
    parser.add_argument(
        "--max-rank",
        type=int,
        default=15000,
        help="Only sample from model entries before this rank.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=20260606,
        help="Random seed for repeatable word selection.",
    )
    return parser.parse_args()


def is_playable_word(word: str) -> bool:
    if word.endswith(("ed", "ing", "ly")):
        return False

    return (
        bool(WORD_PATTERN.fullmatch(word))
        and any(letter in word for letter in "aeiou")
        and word not in STOPWORDS
        and word not in BLOCKLIST
    )


def read_requested_words(path: Path) -> list[str]:
    words = []

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        word = raw_line.strip().lower()
        if word and not word.startswith("#"):
            words.append(word)

    return list(dict.fromkeys(words))


def choose_words(
    model: KeyedVectors,
    count: int,
    seed: int,
    min_rank: int,
    max_rank: int,
    requested_words_path: Path | None,
) -> list[str]:
    if requested_words_path:
        requested_words = read_requested_words(requested_words_path)
        missing_words = [word for word in requested_words if word not in model]
        invalid_words = [word for word in requested_words if not is_playable_word(word)]

        if missing_words:
            raise ValueError(f"Words not found in model: {', '.join(missing_words)}")

        if invalid_words:
            raise ValueError(f"Words did not pass filters: {', '.join(invalid_words)}")

        return requested_words

    candidates = [
        word
        for rank, word in enumerate(model.index_to_key)
        if min_rank <= rank < max_rank and is_playable_word(word)
    ]

    if len(candidates) < count:
        raise ValueError(
            f"Only found {len(candidates)} playable words; need {count}. "
            "Try increasing --max-rank, increasing --limit, or lowering --min-rank.",
        )

    rng = random.Random(seed)
    return sorted(rng.sample(candidates, count))


def build_scores(model: KeyedVectors, words: list[str]) -> list[list[float]]:
    vectors = np.array([model.get_vector(word, norm=True) for word in words])
    scores = np.matmul(vectors, vectors.T) * 100
    np.fill_diagonal(scores, 100)
    return [[round(float(value), 2) for value in row] for row in scores]


def main() -> None:
    args = parse_args()
    model_path = args.model.expanduser()

    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    print(f"Loading Word2Vec model from {model_path}")
    print(f"Vector load limit: {args.limit:,}")
    model = KeyedVectors.load_word2vec_format(
        str(model_path),
        binary=True,
        limit=args.limit,
    )

    words = choose_words(
        model=model,
        count=args.word_count,
        seed=args.seed,
        min_rank=args.min_rank,
        max_rank=args.max_rank,
        requested_words_path=args.words,
    )
    scores = build_scores(model, words)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"words": words, "scores": scores}, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(words)} words to {args.output}")
    print(", ".join(words[:20]) + ("..." if len(words) > 20 else ""))


if __name__ == "__main__":
    main()
