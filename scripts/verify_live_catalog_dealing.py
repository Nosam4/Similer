#!/usr/bin/env python3
"""Verify live catalog dealing inside a transaction that is always rolled back."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import psycopg


DEFAULT_POOLER_URL_PATH = Path("supabase/.temp/pooler-url")
EMBEDDING_MODEL = "word2vec-google-news-300"


def require_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"{name} is required.")
    return value


def database_connection_kwargs() -> dict[str, object]:
    pooler_url = urlsplit(DEFAULT_POOLER_URL_PATH.read_text(encoding="utf-8").strip())
    if not pooler_url.hostname or not pooler_url.username:
        raise ValueError(f"Invalid pooler URL in {DEFAULT_POOLER_URL_PATH}.")

    return {
        "host": pooler_url.hostname,
        "port": pooler_url.port or 5432,
        "dbname": pooler_url.path.lstrip("/") or "postgres",
        "user": pooler_url.username,
        "password": require_environment("SUPABASE_DB_PASSWORD"),
        "sslmode": "require",
    }


def make_state(hand_number: int) -> dict[str, object]:
    return {
        "handNumber": hand_number,
        "phase": "preflop",
        "players": [
            {"id": 0, "inHand": True, "holeWord": None},
            {"id": 1, "inHand": True, "holeWord": None},
        ],
    }


def deal_hand(
    cursor: psycopg.Cursor,
    *,
    room_id: str,
    hand_number: int,
    expected_version: int,
    host_user_id: str,
    next_status: str | None,
) -> dict[str, object]:
    cursor.execute(
        """
        select public.deal_catalog_hand(
          %(room_id)s::uuid,
          %(hand_number)s::integer,
          %(expected_version)s::integer,
          array[0, 1]::integer[],
          %(state_json)s::jsonb,
          %(host_user_id)s::uuid,
          %(next_status)s::text,
          %(embedding_model)s::text
        )
        """,
        {
            "room_id": room_id,
            "hand_number": hand_number,
            "expected_version": expected_version,
            "state_json": json.dumps(make_state(hand_number)),
            "host_user_id": host_user_id,
            "next_status": next_status,
            "embedding_model": EMBEDDING_MODEL,
        },
    )
    result = cursor.fetchone()
    if not result or not isinstance(result[0], dict):
        raise ValueError("Catalog deal returned an invalid result.")
    return result[0]


def load_hand_catalog_ids(
    cursor: psycopg.Cursor,
    room_id: str,
    hand_number: int,
    deal_version: int,
) -> tuple[set[int], int]:
    cursor.execute(
        """
        select catalog_word_id, deal_version
        from public.hand_words
        where room_id = %s::uuid and hand_number = %s
        order by player_id
        """,
        (room_id, hand_number),
    )
    word_rows = cursor.fetchall()
    if len(word_rows) != 2 or any(int(row[1]) != deal_version for row in word_rows):
        raise ValueError(f"Hand {hand_number} has invalid player assignments.")

    cursor.execute(
        """
        select catalog_word_id, cycle_number
        from public.get_catalog_hand_reservation(%s::uuid, %s, %s)
        """,
        (room_id, hand_number, deal_version),
    )
    reservation_rows = cursor.fetchall()
    if len(reservation_rows) != 1:
        raise ValueError(f"Hand {hand_number} has no unique neutral reservation.")

    catalog_ids = {int(row[0]) for row in word_rows}
    catalog_ids.add(int(reservation_rows[0][0]))
    if len(catalog_ids) != 3:
        raise ValueError(f"Hand {hand_number} repeats a catalog word.")

    return catalog_ids, int(reservation_rows[0][1])


def main() -> None:
    with psycopg.connect(**database_connection_kwargs()) as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute("select id from auth.users order by created_at limit 2")
                user_ids = [str(row[0]) for row in cursor.fetchall()]
                if len(user_ids) < 2:
                    raise ValueError("Live verification needs two existing Supabase users.")

                cursor.execute(
                    """
                    insert into public.rooms (code, host_user_id, status, max_players)
                    values (public.generate_room_code(), %s::uuid, 'waiting', 2)
                    returning id
                    """,
                    (user_ids[0],),
                )
                room_id = str(cursor.fetchone()[0])

                cursor.execute(
                    """
                    insert into public.room_players
                      (room_id, user_id, display_name, seat_index, is_ready)
                    values
                      (%s::uuid, %s::uuid, 'VerifyA', 0, true),
                      (%s::uuid, %s::uuid, 'VerifyB', 1, true)
                    """,
                    (room_id, user_ids[0], room_id, user_ids[1]),
                )
                cursor.execute(
                    """
                    insert into public.room_states (room_id, version, state_json, updated_by)
                    values (%s::uuid, 1, '{}'::jsonb, %s::uuid)
                    """,
                    (room_id, user_ids[0]),
                )

                first_deal = deal_hand(
                    cursor,
                    room_id=room_id,
                    hand_number=1,
                    expected_version=1,
                    host_user_id=user_ids[0],
                    next_status="playing",
                )
                if int(first_deal["roomState"]["version"]) != 2 or first_deal["idempotent"]:
                    raise ValueError("First deal did not atomically advance room state to version 2.")
                first_ids, first_cycle = load_hand_catalog_ids(cursor, room_id, 1, 2)

                repeated_deal = deal_hand(
                    cursor,
                    room_id=room_id,
                    hand_number=1,
                    expected_version=1,
                    host_user_id=user_ids[0],
                    next_status="playing",
                )
                if int(repeated_deal["roomState"]["version"]) != 2 or not repeated_deal["idempotent"]:
                    raise ValueError("Retry did not return the idempotent first deal.")

                second_deal = deal_hand(
                    cursor,
                    room_id=room_id,
                    hand_number=2,
                    expected_version=2,
                    host_user_id=user_ids[0],
                    next_status=None,
                )
                if int(second_deal["roomState"]["version"]) != 3:
                    raise ValueError("Second deal did not atomically advance room state to version 3.")
                second_ids, second_cycle = load_hand_catalog_ids(cursor, room_id, 2, 3)

                if first_cycle != second_cycle or first_ids & second_ids:
                    raise ValueError("Shuffle-cycle dealing repeated a word before cycle exhaustion.")

                cursor.execute(
                    """
                    select
                      has_function_privilege(
                        'anon',
                        'public.deal_catalog_hand(uuid,integer,integer,integer[],jsonb,uuid,text,text)',
                        'execute'
                      ),
                      has_function_privilege(
                        'authenticated',
                        'public.get_catalog_hand_reservation(uuid,integer,integer)',
                        'execute'
                      )
                    """,
                )
                anonymous_deal_access, browser_reservation_access = cursor.fetchone()
                if anonymous_deal_access or browser_reservation_access:
                    raise ValueError("A browser role can access a service-only catalog-dealing function.")

                print("Transactional deal check: state, player words, and neutral word committed together")
                print("Idempotency check: retry preserved the original deal and state version")
                print("Shuffle-cycle check: consecutive hands used six distinct catalog words")
                print("Permission check: browser roles cannot deal or read neutral reservations")
        finally:
            connection.rollback()
            print("Cleanup check: verification transaction rolled back")


if __name__ == "__main__":
    main()
