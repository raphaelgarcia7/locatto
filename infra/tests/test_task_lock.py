"""The hourly worker must not start a duplicate implementation."""

import importlib.util
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "task_lock", Path(__file__).parents[1] / "automation" / "task_lock.py"
)
task_lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(task_lock)


def test_only_one_concurrent_claim_wins(tmp_path):
    lock = tmp_path / "automation.lock"
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda n: task_lock.claim(lock, str(n), "ROP-TEST"), range(8))
        )
    assert sum(results) == 1
    assert task_lock.status(lock)["occupied"]


def test_only_owner_can_release(tmp_path):
    lock = tmp_path / "automation.lock"
    assert task_lock.claim(lock, "run-1", "ROP-TEST")
    assert not task_lock.release(lock, "run-2")
    assert not task_lock.claim(lock, "run-2", "ROP-TEST")
    assert task_lock.release(lock, "run-1")
    assert task_lock.status(lock) == {"occupied": False}
    assert task_lock.claim(lock, "run-2", "ROP-TEST")


def test_incomplete_lock_blocks_execution(tmp_path):
    lock = tmp_path / "automation.lock"
    lock.mkdir()
    assert task_lock.status(lock) == {"occupied": True, "requires_review": True}
    assert not task_lock.claim(lock, "run-1", "ROP-TEST")
    assert not task_lock.release(lock, "run-1")


def test_stale_release_cannot_remove_new_owner(tmp_path):
    lock = tmp_path / "automation.lock"
    assert task_lock.claim(lock, "old", "issue-1")
    assert task_lock.status(lock)["record"]["owner"] == "old"
    assert task_lock.release(lock, "old")
    assert task_lock.claim(lock, "new", "issue-2")
    assert not task_lock.release(lock, "old")
    assert task_lock.status(lock)["record"]["owner"] == "new"


def test_concurrent_duplicate_release_only_succeeds_once(tmp_path):
    lock = tmp_path / "automation.lock"
    assert task_lock.claim(lock, "old", "issue-1")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: task_lock.release(lock, "old"), range(8)))
    assert sum(results) == 1
    assert task_lock.claim(lock, "new", "issue-2")
    assert not task_lock.claim(lock, "old", "issue-1")


def test_owner_cannot_be_reused_even_after_completion(tmp_path):
    lock = tmp_path / "automation.lock"
    assert task_lock.claim(lock, "unique", "issue-1")
    assert task_lock.release(lock, "unique")
    assert not task_lock.claim(lock, "unique", "issue-2")


def test_progress_persists_and_only_current_owner_can_change_it(tmp_path):
    lock = tmp_path / "automation.lock"
    assert task_lock.claim(lock, "run-1", "issue-1")
    progress = {"phase": "validating", "head_sha": "abc", "agent_id": "agent-1"}
    assert task_lock.checkpoint(lock, "run-1", progress)
    assert not task_lock.checkpoint(lock, "other", {"phase": "done"})
    assert task_lock.status(lock)["record"]["progress"] == progress


def test_corrupt_journal_does_not_report_available(tmp_path):
    lock = tmp_path / "automation.lock"
    lock.with_suffix(".sqlite3").write_text("not a database", encoding="utf-8")
    assert task_lock.status(lock) == {"occupied": True, "requires_review": True}


def test_invalid_claim_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        task_lock.claim(tmp_path / "automation.lock", "", "issue-1")


def test_independent_processes_cannot_claim_same_workspace(tmp_path):
    script = Path(__file__).parents[1] / "automation" / "task_lock.py"

    def attempt(index):
        return subprocess.run(
            [
                sys.executable,
                str(script),
                "claim",
                "--workspace",
                str(tmp_path),
                "--owner",
                f"process-{index}",
                "--task",
                "issue-1",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(result.returncode == 0 for result in results) == 1
    assert all(result.returncode in (0, 1) and not result.stderr for result in results)
    # The winning process has exited; ownership survives until explicit release.
    assert task_lock.status(tmp_path / ".locatto" / "automation.lock")["occupied"]
