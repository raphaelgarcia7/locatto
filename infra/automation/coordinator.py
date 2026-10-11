"""Fail-closed delivery decisions, independent of agent transport or scheduler."""

from dataclasses import dataclass
from typing import Literal

Action = Literal[
    "blocked", "dispatch", "resume", "review", "merge", "reconcile", "done"
]


@dataclass(frozen=True)
class DeliveryState:
    issue_number: int
    project_status: str
    issue_open: bool
    approval_matches: bool
    dependencies_done_and_merged: bool
    decisions_resolved: bool
    access_confirmed: bool
    quota_available: bool
    executor_model: str
    executor_effort: str
    reviewer_model: str
    reviewer_effort: str
    owner_confirmed: bool
    existing_execution_known: bool
    execution_started: bool = False
    agents_stopped: bool = False
    pr_exists: bool = False
    pr_merged_into_develop: bool = False
    checks_passed: bool = False
    reviewed_head_matches: bool = False
    base_current: bool = False
    protection_confirmed: bool = False
    pr_base_develop: bool = False
    pr_same_repository: bool = False
    pr_expected_branch: bool = False
    pr_open_ready: bool = False
    criteria_met: bool = False
    evidence_current: bool = False


def next_action(state: DeliveryState) -> Action:
    # A remote merge survives an interrupted Project write and consumed quota.
    # Never redispatch a merged implementation or call issue.closed Project Done.
    if state.pr_merged_into_develop:
        return (
            "done"
            if all(
                [
                    state.project_status == "Done",
                    state.agents_stopped,
                    state.owner_confirmed,
                    state.existing_execution_known,
                ]
            )
            else "reconcile"
        )
    if state.project_status == "Done" or not state.issue_open:
        return "blocked"
    if not all(
        [
            0 < state.issue_number <= 16,
            state.approval_matches,
            state.dependencies_done_and_merged,
            state.decisions_resolved,
            state.access_confirmed,
            state.quota_available,
            state.executor_model == "gpt-6.1-sol",
            state.executor_effort == "high",
            state.reviewer_model == "gpt-6-sol",
            state.reviewer_effort == "high",
            state.owner_confirmed,
            state.existing_execution_known,
        ]
    ):
        return "blocked"
    if state.execution_started or state.pr_exists:
        if not state.agents_stopped or not state.pr_exists:
            return "resume"
        if not state.reviewed_head_matches:
            return "review"
        if all(
            [
                state.project_status == "Validating",
                state.checks_passed,
                state.base_current,
                state.protection_confirmed,
                state.pr_base_develop,
                state.pr_same_repository,
                state.pr_expected_branch,
                state.pr_open_ready,
                state.criteria_met,
                state.evidence_current,
            ]
        ):
            return "merge"
        return "resume"
    return "dispatch" if state.project_status == "Ready" else "blocked"
