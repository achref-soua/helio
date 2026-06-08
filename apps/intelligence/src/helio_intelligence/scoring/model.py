"""Gradient-boosted propensity models with a transparent fallback.

The headline path trains a ``HistGradientBoostingClassifier`` over the
behavioral features. Real installs often start with too little labeled
data to train anything trustworthy, so when the label is single-valued or
the sample is tiny we fall back to a deterministic, monotonic heuristic
(rank by a weighted engagement sum, squashed to [0,1]). Both return a
calibrated-ish probability per contact, and which path ran is reported so
the UI can be honest about it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray
from sklearn.ensemble import HistGradientBoostingClassifier

# Below this many labeled rows, or with only one class present, training a
# boosted model overfits — use the heuristic instead.
MIN_TRAIN_ROWS = 40
MIN_MINORITY_ROWS = 5


class Predictor(Protocol):
    def predict(self, features: NDArray[np.float64]) -> NDArray[np.float64]: ...


@dataclass(frozen=True)
class TrainedModel:
    method: str  # "gradient_boosting" | "heuristic"
    _clf: HistGradientBoostingClassifier | None
    _weights: NDArray[np.float64] | None
    _positive_class: int

    def predict(self, features: NDArray[np.float64]) -> NDArray[np.float64]:
        if features.shape[0] == 0:
            return np.zeros(0, dtype=np.float64)
        if self._clf is not None:
            proba = self._clf.predict_proba(features)
            classes = list(self._clf.classes_)
            col = classes.index(self._positive_class) if self._positive_class in classes else -1
            return np.asarray(proba[:, col], dtype=np.float64)
        return _heuristic_scores(features, self._weights)


def train(
    features: NDArray[np.float64],
    labels: NDArray[np.bool_],
    *,
    seed: int = 13,
) -> TrainedModel:
    """Fit a propensity model, or build a heuristic when data is too thin."""
    y = labels.astype(int)
    positives = int(y.sum())
    negatives = int(len(y) - positives)
    trainable = (
        len(y) >= MIN_TRAIN_ROWS
        and positives >= MIN_MINORITY_ROWS
        and negatives >= MIN_MINORITY_ROWS
    )
    if trainable:
        clf = HistGradientBoostingClassifier(
            max_depth=3,
            max_iter=120,
            learning_rate=0.08,
            l2_regularization=1.0,
            random_state=seed,
        )
        clf.fit(features, y)
        return TrainedModel(method="gradient_boosting", _clf=clf, _weights=None, _positive_class=1)
    return TrainedModel(
        method="heuristic", _clf=None, _weights=_heuristic_weights(features), _positive_class=1
    )


def _heuristic_weights(features: NDArray[np.float64]) -> NDArray[np.float64]:
    """Per-column inverse-scale so no single large-magnitude feature
    dominates the weighted sum; constant columns get zero weight."""
    if features.shape[0] == 0:
        return np.ones(features.shape[1], dtype=np.float64)
    spread = features.std(axis=0)
    constant = spread == 0
    spread[constant] = 1.0
    weights: NDArray[np.float64] = np.asarray(1.0 / spread, dtype=np.float64)
    weights[constant] = 0.0
    return weights


def _heuristic_scores(
    features: NDArray[np.float64], weights: NDArray[np.float64] | None
) -> NDArray[np.float64]:
    if weights is None:
        weights = _heuristic_weights(features)
    raw = features @ weights
    if raw.size == 0:
        return raw
    lo, hi = float(raw.min()), float(raw.max())
    if hi - lo < 1e-9:
        return np.full(raw.shape, 0.5, dtype=np.float64)
    return (raw - lo) / (hi - lo)
