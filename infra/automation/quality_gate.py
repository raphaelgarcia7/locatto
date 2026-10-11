"""The final check accepts only explicit success from every required job."""

import os

REQUIRED = ("backend", "frontend", "browser", "secrets")


def failures(results: dict[str, str]) -> list[str]:
    return [name for name in REQUIRED if results.get(name) != "success"]


if __name__ == "__main__":
    failed = failures(
        {name: os.environ.get(name.upper() + "_RESULT", "") for name in REQUIRED}
    )
    if failed:
        print("Quality jobs did not succeed: " + ", ".join(failed))
    raise SystemExit(1 if failed else 0)
