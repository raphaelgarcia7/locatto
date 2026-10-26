"""Single-host execution journal with atomic ownership; no time-based stealing."""

import argparse
import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict


class RunRecord(TypedDict):
    owner: str
    task: str
    started_at: str
    progress: dict[str, str]


class LockStatus(TypedDict, total=False):
    occupied: bool
    requires_review: bool
    record: RunRecord


@contextmanager
def journal(lock: Path) -> Iterator[sqlite3.Connection]:
    """Keep the database file; deleting it invalidates process coordination."""
    lock.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(lock.with_suffix(".sqlite3"), timeout=5)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS runs ("
            "owner TEXT PRIMARY KEY, task TEXT NOT NULL, started_at TEXT NOT NULL, "
            "active INTEGER NOT NULL CHECK(active IN (0, 1)), "
            "progress TEXT NOT NULL DEFAULT '{}', finished_at TEXT)"
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS one_active_run "
            "ON runs(active) WHERE active = 1"
        )
        with connection:
            yield connection
    finally:
        connection.close()


def claim(lock: Path, owner: str, task: str) -> bool:
    """Unique active slot and never-reused owner prevent stale release races."""
    if not owner.strip() or not task.strip():
        raise ValueError("owner and task must be nonempty")
    if lock.exists():
        return False  # Legacy file lock requires explicit reconciliation.
    with journal(lock) as connection:
        cursor = connection.execute(
            "INSERT OR IGNORE INTO runs(owner, task, started_at, active) "
            "VALUES (?, ?, ?, 1)",
            (owner, task, datetime.now(UTC).isoformat()),
        )
        return cursor.rowcount == 1


def status(lock: Path) -> LockStatus:
    if lock.exists():
        return {"occupied": True, "requires_review": True}
    try:
        with journal(lock) as connection:
            row = connection.execute(
                "SELECT owner, task, started_at, progress FROM runs WHERE active = 1"
            ).fetchone()
        if row is None:
            return {"occupied": False}
        progress = json.loads(row[3])
        if not isinstance(progress, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in progress.items()
        ):
            raise ValueError("Invalid progress record")
        return {
            "occupied": True,
            "record": RunRecord(
                owner=row[0], task=row[1], started_at=row[2], progress=progress
            ),
        }
    except OSError, sqlite3.Error, ValueError:
        return {"occupied": True, "requires_review": True}


def checkpoint(lock: Path, owner: str, progress: dict[str, str]) -> bool:
    """Save complete progress metadata only for the current owner."""
    if not isinstance(progress, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in progress.items()
    ):
        raise ValueError("expected an object of strings")
    if lock.exists():
        return False
    with journal(lock) as connection:
        cursor = connection.execute(
            "UPDATE runs SET progress = ? WHERE owner = ? AND active = 1",
            (json.dumps(progress), owner),
        )
        return cursor.rowcount == 1


def release(lock: Path, owner: str) -> bool:
    """Ownership check and release are one conditional database write."""
    if lock.exists():
        return False
    with journal(lock) as connection:
        cursor = connection.execute(
            "UPDATE runs SET active = 0, finished_at = ? "
            "WHERE owner = ? AND active = 1",
            (datetime.now(UTC).isoformat(), owner),
        )
        return cursor.rowcount == 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "claim", "checkpoint", "release"])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--owner")
    parser.add_argument("--task")
    parser.add_argument("--progress", help="Complete JSON object of string metadata")
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    if not workspace.is_dir():
        parser.error("workspace must be an existing directory")
    lock = workspace / ".locatto" / "automation.lock"
    if args.action == "status":
        print(json.dumps(status(lock)))
        return
    if not args.owner or (args.action == "claim" and not args.task):
        parser.error("owner is required; claim also requires task")
    if args.action == "claim":
        success = claim(lock, args.owner, args.task)
    elif args.action == "checkpoint":
        try:
            progress = json.loads(args.progress or "null")
            if not isinstance(progress, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in progress.items()
            ):
                raise ValueError("expected an object of strings")
        except ValueError as error:
            parser.error(str(error))
        success = checkpoint(lock, args.owner, progress)
    else:
        success = release(lock, args.owner)
    print(json.dumps({"success": success}))
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
