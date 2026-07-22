#!/usr/bin/env python3
"""Export normalized playable-word embeddings for the private Supabase catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from gensim.models import KeyedVectors


DEFAULT_MODEL_PATH = Path("~/Downloads/word2vec-google-news-300.gz").expanduser()
DEFAULT_WORDS_PATH = Path("src/wordgame/wordBank.json")
DEFAULT_OUTPUT_PATH = Path("supabase/.private/word-embeddings.json")
DEFAULT_MODEL_NAME = "word2vec-google-news-300"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export one normalized Word2Vec embedding per playable word.",
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help=f"Word2Vec binary model. Default: {DEFAULT_MODEL_PATH}",
    )
    parser.add_argument(
        "--words",
        type=Path,
        default=DEFAULT_WORDS_PATH,
        help=f"JSON word bank or newline-delimited word list. Default: {DEFAULT_WORDS_PATH}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Server-only JSON output. Default: {DEFAULT_OUTPUT_PATH}",
    )
    parser.add_argument(
        "--model-name",
        default=DEFAULT_MODEL_NAME,
        help=f"Model version stored with each catalog row. Default: {DEFAULT_MODEL_NAME}",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50000,
        help="Only load the first N vectors from the model. Default: 50000",
    )
    return parser.parse_args()


def read_words(path: Path) -> list[str]:
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

    words = [str(word).strip().lower() for word in raw_words if str(word).strip()]
    unique_words = list(dict.fromkeys(words))

    if len(unique_words) != len(words):
        raise ValueError(f"{path} contains duplicate words after normalization.")

    if not unique_words:
        raise ValueError(f"{path} does not contain any words.")

    return unique_words


def main() -> None:
    args = parse_args()
    model_path = args.model.expanduser()
    words_path = args.words.expanduser()
    output_path = args.output.expanduser()

    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")
    if not words_path.exists():
        raise FileNotFoundError(f"Word list not found: {words_path}")

    words = read_words(words_path)
    print(f"Loading up to {args.limit:,} vectors from {model_path}")
    model = KeyedVectors.load_word2vec_format(
        str(model_path),
        binary=True,
        limit=args.limit,
    )

    missing_words = [word for word in words if word not in model]
    if missing_words:
        raise ValueError(
            "Words missing from the loaded model: " + ", ".join(missing_words),
        )

    records = [
        {
            "word": word,
            "embedding": model.get_vector(word, norm=True).tolist(),
            "active": True,
        }
        for word in words
    ]

    payload = {
        "embeddingModel": args.model_name,
        "dimensions": int(model.vector_size),
        "normalized": True,
        "words": records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(records):,} normalized {model.vector_size}-D embeddings to {output_path}")


if __name__ == "__main__":
    main()
