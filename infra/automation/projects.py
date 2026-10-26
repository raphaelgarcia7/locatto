"""Projects v2 through the existing authenticated CLI, without handling tokens."""

import argparse
import hashlib
import json
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from infra.automation.task_lock import status

STATUSES = {"Planning", "Ready", "In progress", "Validating", "Blocked", "Done"}


class ProjectError(RuntimeError):
    """Unknown, changed or unauthorized remote state; never assume success."""


def graphql(query: str, variables: dict[str, str], cli: str = "gh") -> dict[str, Any]:
    payload = json.dumps({"query": query, "variables": variables})
    try:
        result = subprocess.run(
            [cli, "api", "graphql", "--input", "-"],
            input=payload,
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=60,
            check=False,
        )
        data = json.loads(result.stdout)
        if result.returncode or data.get("errors") or not data.get("data"):
            raise ProjectError("Project API unavailable; reconcile before retry")
        return data["data"]  # type: ignore[no-any-return]
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError) as error:
        # Do not expose CLI stderr, issue bodies or authentication diagnostics.
        raise ProjectError(
            "Project API result unknown; reconcile before retry"
        ) from error


@dataclass(frozen=True)
class ProjectItem:
    project_id: str
    item_id: str
    number: int
    repository: str
    closed: bool
    status: str
    priority: str | None
    updated_at: str
    body_sha256: str
    status_field_id: str
    status_options: dict[str, str]

    def require_revision(self, updated_at: str, body_sha256: str) -> None:
        if (self.updated_at, self.body_sha256) != (updated_at, body_sha256):
            raise ProjectError("Approved issue revision changed")


PROJECT_QUERY = """
query($project:ID!,$item:ID!){
  project:node(id:$project){... on ProjectV2{
    id viewerCanUpdate fields(first:100){pageInfo{hasNextPage} nodes{
      ... on ProjectV2SingleSelectField{id name options{id name}}
    }}
  }}
  item:node(id:$item){... on ProjectV2Item{
    id project{id} content{... on Issue{
      number closed updatedAt body repository{nameWithOwner}
    }} fieldValues(first:100){pageInfo{hasNextPage} nodes{
      ... on ProjectV2ItemFieldSingleSelectValue{
        name field{... on ProjectV2SingleSelectField{name}}
      }
    }}
  }}
}
"""


class Projects:
    def __init__(self, project: str, cli: str = "gh") -> None:
        self.project = project
        self.cli = cli

    def read(self, item: str) -> ProjectItem:
        data = graphql(PROJECT_QUERY, {"project": self.project, "item": item}, self.cli)
        try:
            project, remote = data["project"], data["item"]
            if (
                project["id"] != self.project
                or project["viewerCanUpdate"] is not True
                or remote["project"]["id"] != self.project
                or project["fields"]["pageInfo"]["hasNextPage"]
                or remote["fieldValues"]["pageInfo"]["hasNextPage"]
            ):
                raise ProjectError("Project access or complete state not confirmed")
            fields = [
                f for f in project["fields"]["nodes"] if f.get("name") == "Status"
            ]
            if len(fields) != 1:
                raise ProjectError("Exactly one Status field required")
            field = fields[0]
            options = {o["name"]: o["id"] for o in field["options"]}
            if set(options) != STATUSES or len(field["options"]) != len(STATUSES):
                raise ProjectError("Expected six Project statuses")
            values = {
                f["field"]["name"]: f["name"]
                for f in remote["fieldValues"]["nodes"]
                if f.get("field")
            }
            current = values["Status"]
            if current not in options:
                raise ProjectError("Unknown Project status")
            issue = remote["content"]
            return ProjectItem(
                self.project,
                remote["id"],
                issue["number"],
                issue["repository"]["nameWithOwner"],
                issue["closed"],
                current,
                values.get("Priority"),
                issue["updatedAt"],
                hashlib.sha256(issue["body"].encode("utf-8")).hexdigest(),
                field["id"],
                options,
            )
        except (KeyError, TypeError, AttributeError) as error:
            raise ProjectError("Incomplete Project/issue state") from error

    def move(
        self,
        item: str,
        *,
        expected_previous_status: str,
        target: str,
        updated_at: str,
        body_sha256: str,
    ) -> ProjectItem:
        before = self.read(item)
        before.require_revision(updated_at, body_sha256)
        if before.closed:
            raise ProjectError("Closed issue requires manual reconciliation")
        if target not in STATUSES or expected_previous_status not in STATUSES:
            raise ProjectError("Unknown transition status")
        if before.status == target:
            return before  # Replay after a lost response; no second write.
        if before.status != expected_previous_status:
            raise ProjectError("Previous status changed; reconcile before mutation")
        graphql(
            """mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
              updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,
                fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}
            }""",
            {
                "project": self.project,
                "item": item,
                "field": before.status_field_id,
                "option": before.status_options[target],
            },
            self.cli,
        )
        after = self.read(item)
        after.require_revision(updated_at, body_sha256)
        if after.status != target or after.closed:
            raise ProjectError("Project write not confirmed; reconcile before retry")
        return after


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["read", "move"])
    parser.add_argument("--project", required=True)
    parser.add_argument("--item", required=True)
    parser.add_argument("--cli", default="gh")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--owner")
    parser.add_argument("--expected-previous-status")
    parser.add_argument("--target")
    parser.add_argument("--updated-at")
    parser.add_argument("--body-sha256")
    args = parser.parse_args()
    adapter = Projects(args.project, args.cli)
    if args.action == "read":
        result = adapter.read(args.item)
    else:
        if not all(
            [
                args.workspace,
                args.owner,
                args.expected_previous_status,
                args.target,
                args.updated_at,
                args.body_sha256,
            ]
        ):
            parser.error(
                "move requires owner, workspace, statuses and approved revision"
            )
        lock = status(args.workspace.resolve(strict=True) / ".locatto/automation.lock")
        if (
            lock.get("requires_review")
            or lock.get("record", {}).get("owner") != args.owner
        ):
            parser.error("Shared execution owner not confirmed")
        result = adapter.move(
            args.item,
            expected_previous_status=args.expected_previous_status,
            target=args.target,
            updated_at=args.updated_at,
            body_sha256=args.body_sha256,
        )
    print(json.dumps(asdict(result)))


if __name__ == "__main__":
    main()
