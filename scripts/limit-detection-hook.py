#!/usr/bin/env python3
"""Claude Code Stop hook: detect usage-limit conditions, send a desktop
notification, and launch `claude /login` to re-authenticate.

This script is invoked by Claude Code as a Stop hook.  Claude Code pipes a
JSON payload to stdin with at least the following fields:

  {
    "session_id":      "<uuid>",
    "transcript_path": "/path/to/transcript.jsonl",
    "stop_hook_active": false
  }

When a usage-limit condition is detected (keywords in the most-recent
assistant message of the transcript, or in the payload's own `reason`
field) the script:

  1. Sends a desktop notification via the platform-native mechanism.
  2. Spawns `claude /login` so the user can re-authenticate immediately.

Exit codes
----------
0 – nothing to do (or limit detected and actions dispatched).
1 – unexpected error while reading / parsing input.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# ── keyword sets ─────────────────────────────────────────────────────────────

#: Keywords searched in the `reason` field of the hook payload.
REASON_KEYWORDS: frozenset[str] = frozenset(
    {"limit", "quota", "rate", "exceeded", "unauthorized", "billing"}
)

#: Phrases searched in the transcript text (lowercased).
TRANSCRIPT_PHRASES: tuple[str, ...] = (
    "usage limit",
    "rate limit",
    "quota exceeded",
    "limit reached",
    "you have reached",
    "context window",
    "max tokens",
    "billing",
    "plan limit",
    "daily limit",
)


# ── notification helpers ──────────────────────────────────────────────────────


def send_notification(title: str, message: str) -> None:
    """Send a best-effort desktop notification appropriate for the platform."""
    try:
        if sys.platform == "darwin":
            script = (
                f'display notification "{message}" with title "{title}" '
                'sound name "Glass"'
            )
            subprocess.run(["osascript", "-e", script], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["notify-send", "--urgency=critical", title, message], check=False)
        elif sys.platform == "win32":
            ps_cmd = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                f'[System.Windows.Forms.MessageBox]::Show("{message}", "{title}")'
            )
            subprocess.run(["powershell", "-Command", ps_cmd], check=False)
    except FileNotFoundError:
        # Notification binary not available – fall back to stderr.
        print(f"[limit-detection-hook] {title}: {message}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"[limit-detection-hook] notification error: {exc}", file=sys.stderr)


# ── limit detection ───────────────────────────────────────────────────────────


def _check_reason(payload: dict) -> bool:
    """Return True when the payload's `reason` field contains a limit keyword."""
    reason = payload.get("reason", "").lower()
    return bool(reason and any(kw in reason for kw in REASON_KEYWORDS))


def _check_transcript(transcript_path: str) -> bool:
    """Return True when the transcript's last assistant message contains a
    limit-related phrase."""
    path = Path(transcript_path)
    if not path.is_file():
        return False
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False

    # Walk the JSONL transcript in reverse to find the latest assistant turn.
    for raw in reversed(lines):
        raw = raw.strip()
        if not raw:
            continue
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue

        role = entry.get("role", "")
        if role != "assistant":
            continue

        # The content may be a plain string or a list of content blocks.
        content = entry.get("content", "")
        if isinstance(content, list):
            text = " ".join(
                block.get("text", "") for block in content if isinstance(block, dict)
            )
        else:
            text = str(content)

        text_lower = text.lower()
        if any(phrase in text_lower for phrase in TRANSCRIPT_PHRASES):
            return True

        # Only inspect the most-recent assistant turn.
        break

    return False


def is_limit_reached(payload: dict) -> bool:
    """Return True when any indicator suggests a usage limit was hit."""
    if _check_reason(payload):
        return True
    transcript_path = payload.get("transcript_path", "")
    if transcript_path and _check_transcript(transcript_path):
        return True
    return False


# ── login trigger ─────────────────────────────────────────────────────────────


def run_login() -> None:
    """Spawn `claude /login` so the user can re-authenticate.

    The process is started in the background (Popen, no wait) so the hook
    exits promptly and does not block Claude Code's shutdown sequence.
    """
    try:
        subprocess.Popen(  # noqa: S603
            ["claude", "/login"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except FileNotFoundError:
        print(
            "[limit-detection-hook] 'claude' binary not found; "
            "open a new terminal and run: claude /login",
            file=sys.stderr,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[limit-detection-hook] failed to launch claude /login: {exc}", file=sys.stderr)


# ── entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        return 0

    try:
        payload: dict = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[limit-detection-hook] invalid JSON from stdin: {exc}", file=sys.stderr)
        return 1

    if is_limit_reached(payload):
        send_notification(
            "Claude usage limit reached",
            "Your Claude usage limit has been hit. Launching `claude /login` to re-authenticate.",
        )
        run_login()

    return 0


if __name__ == "__main__":
    sys.exit(main())
