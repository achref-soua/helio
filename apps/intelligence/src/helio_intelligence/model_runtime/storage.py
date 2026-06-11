"""Artifact storage on the intelligence service's models volume."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

MAX_ARTIFACT_BYTES = 50 * 1024 * 1024  # 50 MiB
_ALLOWED_EXTENSIONS = {".onnx", ".json"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")

# ONNX files are protobuf; XGBoost JSON starts as a JSON object. Anything
# else — notably pickle (\x80) — is refused before it touches a loader.
_PICKLE_MAGIC = b"\x80"


class ModelStorageError(ValueError):
    """User-correctable storage problems (size, name, format)."""


def models_root() -> Path:
    return Path(os.environ.get("INTEL_MODELS_PATH", "/var/lib/helio/models"))


def artifact_path(organization_id: str, model_id: str, extension: str) -> Path:
    if not (_SAFE_ID.match(organization_id) and _SAFE_ID.match(model_id)):
        raise ModelStorageError("invalid identifier")
    if extension not in _ALLOWED_EXTENSIONS:
        raise ModelStorageError(f"unsupported artifact extension {extension!r}")
    return models_root() / organization_id / f"{model_id}{extension}"


def sniff_rejects(content: bytes, extension: str) -> str | None:
    """A human reason to refuse the upload, or None when it looks sane."""
    if len(content) == 0:
        return "the file is empty"
    if len(content) > MAX_ARTIFACT_BYTES:
        return f"the file exceeds the {MAX_ARTIFACT_BYTES // (1024 * 1024)} MiB limit"
    if content[:1] == _PICKLE_MAGIC:
        return (
            "pickle files are not accepted (loading one executes arbitrary code). "
            "Export to ONNX instead — for scikit-learn: "
            "skl2onnx.to_onnx(model, X[:1].astype(numpy.float32))"
        )
    if extension == ".json":
        head = content[:64].lstrip()
        if not head.startswith(b"{"):
            return "an XGBoost model export should be JSON (model.save_model('churn.json'))"
    return None


def store_artifact(organization_id: str, model_id: str, extension: str, content: bytes) -> Path:
    """Write the artifact atomically; returns its path."""
    reason = sniff_rejects(content, extension)
    if reason:
        raise ModelStorageError(reason)
    destination = artifact_path(organization_id, model_id, extension)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".tmp")
    tmp.write_bytes(content)
    os.replace(tmp, destination)
    return destination


def artifact_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
