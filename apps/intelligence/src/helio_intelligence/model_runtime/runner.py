"""Parent side of the sandbox: spawn, bound, parse."""

from __future__ import annotations

import json
import os
import subprocess
import sys

_WALL_CLOCK_SECONDS = 30


class ModelRunError(RuntimeError):
    """The artifact could not produce predictions; message is user-facing."""


def predict_with_artifact(
    model_format: str,
    path: str,
    matrix: list[list[float]],
    *,
    positive_index: int = 1,
    timeout_seconds: float = _WALL_CLOCK_SECONDS,
) -> list[float]:
    request = json.dumps(
        {"format": model_format, "path": path, "matrix": matrix, "positive_index": positive_index}
    )
    try:
        completed = subprocess.run(  # noqa: S603 — fixed argv, our own module
            [sys.executable, "-m", "helio_intelligence.model_runtime.sandbox"],
            input=request.encode(),
            capture_output=True,
            timeout=timeout_seconds,
            # Scrubbed environment: the child gets no secrets.
            env={"PATH": os.environ.get("PATH", ""), "HOME": "/tmp"},
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise ModelRunError(
            f"the model took longer than {int(timeout_seconds)}s and was stopped"
        ) from error

    if completed.returncode != 0:
        raise ModelRunError("the model crashed while loading or predicting (resource limits?)")
    reply = None
    for line in reversed(completed.stdout.decode().splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            reply = json.loads(line)
            break
        except ValueError:
            continue
    if not isinstance(reply, dict):
        raise ModelRunError("the model runtime returned garbage")
    if not reply.get("ok"):
        raise ModelRunError(str(reply.get("error") or "the model failed to predict"))
    predictions = reply.get("predictions")
    if not isinstance(predictions, list):
        raise ModelRunError("the model returned no predictions")
    return [float(value) for value in predictions]
