"""The HTTPS predict-endpoint adapter — the escape hatch that makes
"any model type" true: serve the model behind one POST route.

Contract (documented in the BYO-model guide):
  request  → {"feature_names": [...], "inputs": [[...], ...]}
  response → {"predictions": [p0, p1, ...]}   # one float per input row
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

_CHUNK_ROWS = 5_000
_TIMEOUT_SECONDS = 10.0


class HttpModelError(RuntimeError):
    """Endpoint problems, phrased for the dashboard."""


def _host_is_private(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True  # unresolvable — treat as unsafe
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
        ):
            return True
    return False


def guard_endpoint(url: str, *, allow_private: bool, resolve: bool = True) -> None:
    """`resolve=False` skips the DNS-privacy check — used only when an
    injected transport means no real network is touched (tests)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" and not allow_private:
        raise HttpModelError("model endpoints must be https (or enable private endpoints)")
    if parsed.hostname is None:
        raise HttpModelError("the endpoint URL has no host")
    if resolve and not allow_private and _host_is_private(parsed.hostname):
        raise HttpModelError(
            "the endpoint resolves to a private address; set "
            "INTEL_ALLOW_PRIVATE_MODEL_ENDPOINTS=true to allow LAN model servers"
        )


async def predict_via_endpoint(
    url: str,
    feature_names: list[str],
    matrix: list[list[float]],
    *,
    auth_header: str | None = None,
    allow_private: bool = False,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[float]:
    guard_endpoint(url, allow_private=allow_private, resolve=transport is None)
    headers = {"content-type": "application/json"}
    if auth_header:
        headers["authorization"] = auth_header

    predictions: list[float] = []
    async with httpx.AsyncClient(
        timeout=_TIMEOUT_SECONDS, transport=transport, headers=headers
    ) as client:
        for start in range(0, len(matrix), _CHUNK_ROWS):
            chunk = matrix[start : start + _CHUNK_ROWS]
            try:
                response = await client.post(
                    url, json={"feature_names": feature_names, "inputs": chunk}
                )
            except httpx.HTTPError as error:
                raise HttpModelError(f"the endpoint did not answer: {error}") from error
            if response.status_code != 200:
                raise HttpModelError(f"the endpoint answered HTTP {response.status_code}")
            body = response.json()
            part = body.get("predictions")
            if not isinstance(part, list) or len(part) != len(chunk):
                raise HttpModelError(
                    'the endpoint must return {"predictions": [...]} with one value per row'
                )
            predictions.extend(float(value) for value in part)
    return predictions
