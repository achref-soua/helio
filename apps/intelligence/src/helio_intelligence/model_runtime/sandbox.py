"""The isolated model-loading child process.

Run as `python -m helio_intelligence.model_runtime.sandbox`: reads one
JSON request on stdin, loads the artifact, predicts, writes one JSON
reply on stdout. Resource limits are applied before any model bytes are
touched, and the parent launches this with a scrubbed environment and a
wall-clock kill — so even for "safe" formats, library bugs and resource
bombs become a clean FAILED status instead of taking the service down.
"""

from __future__ import annotations

import json
import resource
import sys
from typing import Any

# Virtual address space, not RSS: onnxruntime/numpy map several GiB of VA
# while using far less memory — 4 GiB still stops runaway models cold.
_ADDRESS_SPACE_BYTES = 4 * 1024 * 1024 * 1024
_CPU_SECONDS = 20


def _apply_limits() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (_ADDRESS_SPACE_BYTES, _ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (_CPU_SECONDS, _CPU_SECONDS))


def _pick_probabilities(outputs: list[Any], positive_index: int, rows: int) -> list[float]:
    """Normalize the zoo of classifier output shapes to one float per row."""
    import numpy as np

    for output in outputs:
        # ZipMap (sklearn-converted ONNX): a list of {label: prob} dicts.
        if isinstance(output, list) and output and isinstance(output[0], dict):
            keys = list(output[0].keys())
            key = positive_index if positive_index in output[0] else keys[-1]
            return [float(row[key]) for row in output]
        array = np.asarray(output)
        if array.dtype.kind not in "fc":
            continue  # labels, not probabilities
        if array.ndim == 1 and array.shape[0] == rows:
            return [float(v) for v in array]
        if array.ndim == 2 and array.shape[0] == rows:
            column = positive_index if array.shape[1] > positive_index else array.shape[1] - 1
            return [float(v) for v in array[:, column]]
    raise ValueError("the model produced no per-row probability output")


def _predict(request: dict[str, Any]) -> list[float]:
    import numpy as np

    matrix = np.asarray(request["matrix"], dtype=np.float32)
    positive_index = int(request.get("positive_index", 1))

    if request["format"] == "ONNX":
        import onnxruntime as ort

        session = ort.InferenceSession(request["path"], providers=["CPUExecutionProvider"])
        input_meta = session.get_inputs()[0]
        expected = input_meta.shape[-1]
        if isinstance(expected, int) and expected != matrix.shape[1]:
            raise ValueError(
                f"the model expects {expected} input features but the mapping provides "
                f"{matrix.shape[1]} — adjust the feature mapping"
            )
        outputs = session.run(None, {input_meta.name: matrix})
        return _pick_probabilities(list(outputs), positive_index, matrix.shape[0])

    if request["format"] == "XGBOOST_JSON":
        import xgboost as xgb

        booster = xgb.Booster()
        booster.load_model(request["path"])
        predictions = booster.predict(xgb.DMatrix(matrix))
        return _pick_probabilities([predictions], positive_index, matrix.shape[0])

    raise ValueError(f"unsupported format {request['format']!r}")


def main() -> None:
    _apply_limits()
    # Libraries (onnxruntime notably) chatter on stdout; the contract is
    # therefore "the reply is the LAST line" — flushed after everything.
    try:
        request = json.loads(sys.stdin.read())
        predictions = _predict(request)
        reply = {"ok": True, "predictions": predictions}
    except MemoryError:
        reply = {"ok": False, "error": "the model exceeded the memory limit"}
    except Exception as error:  # noqa: BLE001 — everything becomes a readable reply
        reply = {"ok": False, "error": str(error)[:300]}
    sys.stdout.flush()
    sys.stdout.write("\n" + json.dumps(reply) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
