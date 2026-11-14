"""Run trusted OpenHarness queue maintenance from a scheduler.

Example cron (inside the worker deployment):
    python /app/maintenance.py

Run only in the worker environment with its configured WORKER_DATA_DIR.
"""
from openharness_ingress import prune_terminal_jobs


def main() -> int:
    deleted = prune_terminal_jobs()
    print(f"terminal_jobs_pruned={deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
