#!/usr/bin/env python3
"""Verify exported embeddings reproduce the temporary multiplayer matrix."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DEFAULT_EMBEDDINGS_PATH = Path("supabase/.private/word-embeddings.json")
DEFAULT_MATRIX_PATH = Path("supabase/functions/_shared/wordgame/matrix.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare embedding cosine scores with the existing matrix.",
    )
    parser.add_argument("--embeddings", type=Path, default=DEFAULT_EMBEDDINGS_PATH)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX_PATH)
    parser.add_argument("--tolerance", type=float, default=0.011)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    embedding_data = json.loads(args.embeddings.read_text(encoding="utf-8"))
    matrix_data = json.loads(args.matrix.read_text(encoding="utf-8"))
    embedding_by_word = {
        record["word"]: record["embedding"]
        for record in embedding_data["words"]
    }

    words = matrix_data["words"]
    scores = matrix_data["scores"]
    missing_words = [word for word in words if word not in embedding_by_word]
    if missing_words:
        raise ValueError("Missing exported embeddings: " + ", ".join(missing_words))

    max_delta = 0.0
    worst_pair: tuple[str, str] | None = None
    mismatch_count = 0

    for left_index, left_word in enumerate(words):
        left_vector = embedding_by_word[left_word]

        for right_index, right_word in enumerate(words):
            right_vector = embedding_by_word[right_word]
            calculated_score = 100.0 if left_index == right_index else round(
                sum(left * right for left, right in zip(left_vector, right_vector)) * 100,
                2,
            )
            delta = abs(calculated_score - float(scores[left_index][right_index]))

            if delta > max_delta:
                max_delta = delta
                worst_pair = (left_word, right_word)
            if delta > args.tolerance:
                mismatch_count += 1

    if mismatch_count:
        raise ValueError(
            f"Found {mismatch_count} matrix mismatches above tolerance {args.tolerance}; "
            f"worst pair {worst_pair} differed by {max_delta:.6f}.",
        )

    print(
        f"Verified {len(words) ** 2:,} scores across {len(words)} words; "
        f"maximum delta {max_delta:.6f} at {worst_pair}.",
    )


if __name__ == "__main__":
    main()
