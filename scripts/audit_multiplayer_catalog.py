#!/usr/bin/env python3
"""Audit the tracked multiplayer word catalog and its model coverage."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from gensim.models import KeyedVectors

from generate_multiplayer_catalog import (
    DEFAULT_EXCLUSIONS_PATH,
    PREFERRED_PACK_PATHS,
    read_word_file,
)
from word_catalog_filters import WORD_PATTERN


DEFAULT_MODEL_PATH = Path("~/Downloads/word2vec-google-news-300.gz").expanduser()
DEFAULT_CATALOG_PATH = Path("word-packs/multiplayer-2000.txt")
DEFAULT_REQUIRED_PATH = Path("src/wordgame/wordBank.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit the 2,000-word multiplayer catalog.")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG_PATH)
    parser.add_argument("--required", type=Path, default=DEFAULT_REQUIRED_PATH)
    parser.add_argument("--exclusions", type=Path, default=DEFAULT_EXCLUSIONS_PATH)
    parser.add_argument("--expected-count", type=int, default=2000)
    parser.add_argument("--limit", type=int, default=200000)
    return parser.parse_args()


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        raise ValueError("Cannot calculate a percentile from no values.")
    index = round((len(values) - 1) * fraction)
    return sorted(values)[index]


def main() -> None:
    args = parse_args()
    words = read_word_file(args.catalog)
    required_words = read_word_file(args.required)
    excluded_words = set(read_word_file(args.exclusions))
    preferred_words = set(
        word
        for path in PREFERRED_PACK_PATHS
        for word in read_word_file(path)
    )

    if len(words) != args.expected_count:
        raise ValueError(f"Expected {args.expected_count} words, found {len(words)}.")
    if words != sorted(words):
        raise ValueError("Catalog is not sorted.")
    if any(not WORD_PATTERN.fullmatch(word) for word in words):
        raise ValueError("Catalog contains an invalid word spelling.")

    missing_required = sorted(set(required_words) - set(words))
    if missing_required:
        raise ValueError("Catalog lost required words: " + ", ".join(missing_required))

    reviewed_words = set(required_words) | preferred_words
    prohibited_words = sorted((set(words) & excluded_words) - reviewed_words)
    if prohibited_words:
        raise ValueError("Catalog contains excluded words: " + ", ".join(prohibited_words))

    print(f"Loading up to {args.limit:,} vectors from {args.model.expanduser()}")
    model = KeyedVectors.load_word2vec_format(
        str(args.model.expanduser()),
        binary=True,
        limit=args.limit,
    )
    missing_model_words = [word for word in words if word not in model]
    if missing_model_words:
        raise ValueError("Catalog words missing from model: " + ", ".join(missing_model_words))

    ranks = [model.get_index(word) for word in words]
    preferred_coverage = len(set(words) & preferred_words)
    report = {
        "wordCount": len(words),
        "requiredCoverage": len(required_words),
        "preferredPackCoverage": preferred_coverage,
        "modelDimensions": model.vector_size,
        "rankMinimum": min(ranks),
        "rankP25": percentile(ranks, 0.25),
        "rankMedian": percentile(ranks, 0.50),
        "rankP75": percentile(ranks, 0.75),
        "rankMaximum": max(ranks),
        "minimumLength": min(map(len, words)),
        "maximumLength": max(map(len, words)),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
