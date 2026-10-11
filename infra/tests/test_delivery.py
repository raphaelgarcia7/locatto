"""Delivery decisions and replay tests use no remote writes or shared journal."""

from dataclasses import replace
from unittest.mock import patch

import pytest

from infra.automation.coordinator import DeliveryState, next_action
from infra.automation.projects import STATUSES, ProjectError, Projects, graphql
from infra.automation.quality_gate import REQUIRED, failures
from infra.automation.task_lock import checkpoint, claim, journal, release, status


def ready():
    return DeliveryState(
        issue_number=6,
        project_status="Ready",
        issue_open=True,
        approval_matches=True,
        dependencies_done_and_merged=True,
        decisions_resolved=True,
        access_confirmed=True,
        quota_available=True,
        executor_model="gpt-6.1-sol",
        executor_effort="high",
        reviewer_model="gpt-6-sol",
        reviewer_effort="high",
        owner_confirmed=True,
        existing_execution_known=True,
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("issue_number", 17),
        ("issue_open", False),
        ("approval_matches", False),
        ("dependencies_done_and_merged", False),
        ("decisions_resolved", False),
        ("access_confirmed", False),
        ("quota_available", False),
        ("executor_model", "other"),
        ("executor_effort", "low"),
        ("reviewer_model", "other"),
        ("reviewer_effort", "low"),
        ("owner_confirmed", False),
        ("existing_execution_known", False),
        ("project_status", "Planning"),
        ("project_status", "Done"),
    ],
)
def test_dispatch_requires_every_gate(field, value):
    assert next_action(ready()) == "dispatch"
    assert next_action(replace(ready(), **{field: value})) == "blocked"


def test_interruptions_before_after_pr_merge_and_project_never_redispatch():
    state = replace(ready(), execution_started=True, project_status="In progress")
    assert next_action(state) == "resume"  # Interrupted before PR.
    state = replace(state, pr_exists=True)
    assert next_action(state) == "resume"  # PR response lost; discover and reuse.
    state = replace(state, agents_stopped=True)
    assert next_action(state) == "review"
    state = replace(
        state,
        reviewed_head_matches=True,
        checks_passed=True,
        base_current=True,
        protection_confirmed=True,
        project_status="Validating",
        pr_base_develop=True,
        pr_same_repository=True,
        pr_expected_branch=True,
        pr_open_ready=True,
        criteria_met=True,
        evidence_current=True,
    )
    assert next_action(state) == "merge"
    state = replace(
        state,
        pr_merged_into_develop=True,
        issue_open=False,
        quota_available=False,
        access_confirmed=False,
    )
    assert next_action(state) == "reconcile"  # Merge committed, Project failed.
    assert next_action(replace(state, project_status="Done")) == "done"
    assert (
        next_action(replace(state, project_status="Done", agents_stopped=False))
        == "reconcile"
    )


@pytest.mark.parametrize(
    "field",
    [
        "checks_passed",
        "base_current",
        "protection_confirmed",
        "pr_base_develop",
        "pr_same_repository",
        "pr_expected_branch",
        "pr_open_ready",
        "criteria_met",
        "evidence_current",
    ],
)
def test_merge_gate_missing_does_not_merge(field):
    state = replace(
        ready(),
        execution_started=True,
        pr_exists=True,
        agents_stopped=True,
        reviewed_head_matches=True,
        checks_passed=True,
        base_current=True,
        protection_confirmed=True,
        project_status="Validating",
        pr_base_develop=True,
        pr_same_repository=True,
        pr_expected_branch=True,
        pr_open_ready=True,
        criteria_met=True,
        evidence_current=True,
    )
    assert next_action(replace(state, **{field: False})) == "resume"


@pytest.mark.parametrize("job", REQUIRED)
@pytest.mark.parametrize("result", ["failure", "skipped", "cancelled", "", "unknown"])
def test_final_gate_rejects_every_non_success(job, result):
    results = dict.fromkeys(REQUIRED, "success")
    assert failures(results) == []
    results[job] = result
    assert failures(results) == [job]
    del results[job]
    assert failures(results) == [job]


def project_response(status="Ready", closed=False):
    return {
        "project": {
            "id": "project",
            "viewerCanUpdate": True,
            "fields": {
                "pageInfo": {"hasNextPage": False},
                "nodes": [
                    {
                        "id": "status-field",
                        "name": "Status",
                        "options": [{"name": name, "id": name} for name in STATUSES],
                    }
                ],
            },
        },
        "item": {
            "id": "item",
            "project": {"id": "project"},
            "content": {
                "number": 6,
                "closed": closed,
                "updatedAt": "revision",
                "body": "approved",
                "repository": {"nameWithOwner": "owner/repo"},
            },
            "fieldValues": {
                "pageInfo": {"hasNextPage": False},
                "nodes": [
                    {"name": status, "field": {"name": "Status"}},
                    {"name": "P0", "field": {"name": "Priority"}},
                ],
            },
        },
    }


def move(adapter, **kwargs):
    import hashlib

    values = dict(
        expected_previous_status="Ready",
        target="In progress",
        updated_at="revision",
        body_sha256=hashlib.sha256(b"approved").hexdigest(),
    )
    return adapter.move("item", **(values | kwargs))


def test_project_move_rereads_and_replay_does_not_write_twice():
    responses = [
        project_response(),
        {},
        project_response("In progress"),
        project_response("In progress"),
    ]
    with patch("infra.automation.projects.graphql", side_effect=responses) as api:
        adapter = Projects("project")
        assert move(adapter).status == "In progress"
        assert move(adapter).status == "In progress"
        assert api.call_count == 4


@pytest.mark.parametrize(
    "kwargs",
    [
        {"updated_at": "changed"},
        {"body_sha256": "changed"},
        {"expected_previous_status": "Blocked"},
        {"target": "Not a status"},
    ],
)
def test_revision_previous_status_and_target_guard_precede_write(kwargs):
    with patch(
        "infra.automation.projects.graphql", return_value=project_response()
    ) as api:
        with pytest.raises(ProjectError):
            move(Projects("project"), **kwargs)
        assert api.call_count == 1


def test_closed_and_done_are_distinct_and_closed_never_written():
    with patch(
        "infra.automation.projects.graphql",
        return_value=project_response("Ready", True),
    ) as api:
        adapter = Projects("project")
        item = adapter.read("item")
        assert item.closed and item.status != "Done" and item.priority == "P0"
        with pytest.raises(ProjectError):
            move(adapter)
        assert api.call_count == 2


@pytest.mark.parametrize("kind", ["access", "pagination", "statuses", "project"])
def test_incomplete_remote_state_blocks(kind):
    response = project_response()
    if kind == "access":
        response["project"]["viewerCanUpdate"] = False
    elif kind == "pagination":
        response["project"]["fields"]["pageInfo"]["hasNextPage"] = True
    elif kind == "statuses":
        response["project"]["fields"]["nodes"][0]["options"].pop()
    else:
        response["item"]["project"]["id"] = "other"
    with patch("infra.automation.projects.graphql", return_value=response):
        with pytest.raises(ProjectError):
            Projects("project").read("item")


def test_unknown_write_or_failed_confirmation_requires_reconciliation():
    for responses in [
        [project_response(), ProjectError("unknown")],
        [project_response(), {}, project_response("Blocked")],
        [project_response(), {}, ProjectError("read unavailable")],
    ]:
        with patch("infra.automation.projects.graphql", side_effect=responses):
            with pytest.raises(ProjectError):
                move(Projects("project"))


def test_cli_uses_utf8_and_never_prints_failed_remote_output():
    import subprocess

    completed = subprocess.CompletedProcess([], 0, '{"data":{"name":"aprovação"}}', "")
    with patch(
        "infra.automation.projects.subprocess.run", return_value=completed
    ) as run:
        assert graphql("query", {}) == {"name": "aprovação"}
        assert run.call_args.kwargs["encoding"] == "utf-8"
    completed.returncode = 1
    completed.stdout = '{"errors":[{"message":"private remote content"}]}'
    with patch("infra.automation.projects.subprocess.run", return_value=completed):
        with pytest.raises(ProjectError, match="Project API unavailable") as error:
            graphql("query", {})
        assert "private remote content" not in str(error.value)


@pytest.mark.parametrize(
    "interruption", ["before_pr", "after_pr", "after_merge", "after_project"]
)
def test_recovery_with_temporary_journal_and_fake_remote(interruption, tmp_path):
    lock = tmp_path / "automation.lock"
    assert claim(lock, "owner6", "ROP-006")
    remote = {"pr": None, "merged": False, "status": "In progress"}
    progress = {"phase": "implementing", "pr": "", "head_sha": "head6"}
    assert checkpoint(lock, "owner6", progress)
    if interruption != "before_pr":
        remote["pr"] = "synthetic-pr"
    if interruption in {"after_merge", "after_project"}:
        remote["merged"] = True
    if interruption == "after_project":
        remote["status"] = "Done"
    # Process disappears before its next checkpoint; journal persists unchanged.
    assert not claim(lock, "duplicate", "ROP-006")
    saved = status(lock)["record"]["progress"]
    state = replace(
        ready(),
        project_status=remote["status"],
        execution_started=True,
        pr_exists=remote["pr"] is not None,
        pr_merged_into_develop=remote["merged"],
        agents_stopped=True,
    )
    assert (
        next_action(state)
        == {
            "before_pr": "resume",
            "after_pr": "review",
            "after_merge": "reconcile",
            "after_project": "done",
        }[interruption]
    )
    assert saved == progress
    if remote["merged"]:
        # Fake Project write is the only remaining effect, never a second PR.
        remote["status"] = "Done"
        state = replace(state, project_status="Done")
        assert next_action(state) == "done"
        assert next_action(replace(state, agents_stopped=False)) == "reconcile"
        assert checkpoint(lock, "owner6", saved | {"phase": "done", "pr": remote["pr"]})
        assert release(lock, "owner6")
        assert not release(lock, "owner6")
    else:
        assert status(lock)["occupied"]  # Resume same owner, never expire it.


def test_old_lock_and_invalid_checkpoint_cannot_allow_new_dispatch(tmp_path):
    lock = tmp_path / "automation.lock"
    assert claim(lock, "old-owner", "ROP-006")
    with journal(lock) as connection:
        connection.execute("UPDATE runs SET started_at = '1900-01-01'")
    assert not claim(lock, "new-owner", "ROP-014")
    with pytest.raises(ValueError):
        checkpoint(lock, "old-owner", {"invalid": 1})
    assert status(lock)["record"]["progress"] == {}
