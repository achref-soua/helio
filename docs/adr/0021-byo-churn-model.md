# ADR-0021: Bring-your-own churn models, sandboxed, with a fallback chain

- Status: accepted
- Date: 2026-06-11

## Context

v2 requires operators to "load their churn prediction model and use it",
supporting "all model types" with friendly error handling. Taken
literally, "all model types" means accepting pickles — which execute
arbitrary code on load and would hand any workspace admin remote code
execution on the intelligence service. The feature also runs inside the
scoring path, where a broken customer model must not take predictive
scoring down with it.

## Decision

Three formats cover the ecosystem without the RCE: **ONNX** (every
framework exports to it — scikit-learn via skl2onnx, PyTorch and
TensorFlow via their exporters), **XGBoost JSON** (its native safe
serialization), and an **HTTPS endpoint** (anything else, any language,
served by the customer — chunked 5k-row calls, SSRF-guarded: https-only
and private addresses refused unless the deployment opts in; the
self-host bundle opts in because LAN model servers are its normal case).
Pickle is refused by magic byte regardless of extension, and the error
message carries the skl2onnx recipe.

Uploaded artifacts never execute in the service process: a child Python
with `setrlimit` caps (4 GiB address space — ML libraries map several
GiB of virtual memory legitimately — and 20s CPU), a scrubbed
environment, and a 30s wall-clock kill loads the file and predicts over
JSON-on-stdio. The reply is the last stdout line because onnxruntime
writes diagnostics to stdout. Output normalization accepts flat arrays,
`(n, 2)` probability matrices, and sklearn ZipMap dicts.

The contract between Helio and any model is a pinned, ordered list of
ten feature names, mirrored as literals in `@helio/core` and in the
Python tests so a rename breaks both builds. Operators map a subset in
the UI; the same columns export as a training CSV (churn-eligible
contacts only, emails opt-in).

Ownership is split: the dashboard owns the `churn_model` rows and the
lifecycle — VALIDATING → Ready (validated) → ACTIVE (one per workspace,
transactional swap) / FAILED (reason on the row) — and the intelligence
service owns artifact bytes and verdicts. Validation runs a fixed
8-row sample frame and phrases every failure for an operator, not a
stack trace. Endpoint auth headers live in the credential vault
(ADR-0019) and are decrypted only at call time.

`recompute` prefers the workspace's ACTIVE model and falls back on any
failure: the row goes FAILED with the reason, one system alert is
raised (deduped per model), the built-in model scores the same run, and
`churn_method: custom_failed_fallback` makes the downgrade visible.
Scoring therefore cannot be broken by a customer model.

## Consequences

- "All model types" is satisfied in practice (every mainstream
  framework reaches ONNX or an endpoint) without accepting code
  execution; the refusal teaches the conversion path.
- A compromised or buggy model is contained by the sandbox and the
  fallback chain; the blast radius is one FAILED row and one alert.
- The pinned feature contract makes models portable across Helio
  versions but means new features require a coordinated, versioned
  change on both sides.
- Artifacts live on a service volume, not in Postgres — database
  backups stay small, but artifact files are not covered by
  `helio backup` (documented; the training pipeline is the source of
  truth).
