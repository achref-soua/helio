"""Upload-time validation: run a sample frame through the artifact and
check the output is shaped like churn probabilities."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .runner import ModelRunError, predict_with_artifact

_TOLERANCE = 0.01


@dataclass(frozen=True)
class ValidationOutcome:
    ok: bool
    error: str | None = None


def sample_matrix(n_inputs: int) -> list[list[float]]:
    """Eight rows spanning zeros, typical values, and extremes."""
    rows = [
        [0.0] * n_inputs,
        [1.0] * n_inputs,
        [5.0] * n_inputs,
        [0.0, 1.0] * (n_inputs // 2 + 1),
        [50.0] * n_inputs,
        [365.0] * n_inputs,
        [2.0] * n_inputs,
        [10.0] * n_inputs,
    ]
    return [row[:n_inputs] for row in rows]


def check_probabilities(predictions: list[float], expected_rows: int) -> str | None:
    """A human reason the output is not churn probabilities, or None."""
    if len(predictions) != expected_rows:
        return f"the model returned {len(predictions)} predictions for {expected_rows} rows"
    for value in predictions:
        if not math.isfinite(value):
            return "the model returned a non-finite prediction (NaN/inf)"
        if value < -_TOLERANCE or value > 1 + _TOLERANCE:
            return (
                f"predictions must be probabilities in [0, 1]; got {value:.3f} — "
                "map the probability column with the output setting, or export "
                "the model with probability outputs"
            )
    return None


def validate_artifact(
    model_format: str,
    path: str,
    n_inputs: int,
    *,
    positive_index: int = 1,
) -> ValidationOutcome:
    matrix = sample_matrix(n_inputs)
    try:
        predictions = predict_with_artifact(
            model_format, path, matrix, positive_index=positive_index
        )
    except ModelRunError as error:
        return ValidationOutcome(ok=False, error=str(error))
    reason = check_probabilities(predictions, len(matrix))
    if reason:
        return ValidationOutcome(ok=False, error=reason)
    return ValidationOutcome(ok=True)
