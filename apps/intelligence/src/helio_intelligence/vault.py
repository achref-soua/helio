"""Vault envelope — the Python twin of ``@helio/core``'s crypto-envelope.

Per-organization provider credentials are stored in Postgres sealed as

    enc:v1:<keyfp8>:<iv_b64>:<ct_b64>:<tag_b64>

AES-256-GCM under the deployment's ``HELIO_ENCRYPTION_KEY`` (base64 of 32
raw bytes), with the AAD binding every value to its organization,
credential row, and field name. The byte layout is the committed contract
in ``packages/core/tests/fixtures/crypto-envelope-vectors.json`` — this
module and the Node implementation both replay it in tests, so the two
sides cannot drift. Errors never carry plaintext or key material.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import re
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_PREFIX = "enc"
_VERSION = "v1"
_IV_BYTES = 12
_TAG_BYTES = 16
_KEY_BYTES = 32
_FINGERPRINT_RE = re.compile(r"^[0-9a-f]{8}$")


class VaultFormatError(ValueError):
    """The envelope or key is structurally wrong."""


class VaultKeyUnknownError(ValueError):
    """No provided key matches the envelope's key fingerprint."""

    def __init__(self, fingerprint: str) -> None:
        super().__init__(f"no encryption key matches fingerprint {fingerprint}")
        self.fingerprint = fingerprint


class VaultDecryptError(ValueError):
    """Authentication failed: the value was tampered with or rebound."""

    def __init__(self) -> None:
        super().__init__(
            "envelope failed authentication (tampered, or bound to a different record)"
        )


def _aad(organization_id: str, credential_id: str, field: str) -> bytes:
    return f"helio:cred:{_VERSION}:{organization_id}:{credential_id}:{field}".encode()


def _decode_key(key_b64: str) -> bytes:
    try:
        raw = base64.b64decode(key_b64.strip(), validate=True)
    except (binascii.Error, ValueError) as error:
        raise VaultFormatError("encryption key is not valid base64") from error
    if len(raw) != _KEY_BYTES:
        raise VaultFormatError(f"encryption key must be {_KEY_BYTES} bytes (got {len(raw)})")
    return raw


def _decode_segment(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise VaultFormatError("envelope segment is not valid base64") from error


def key_fingerprint(key_b64: str) -> str:
    """First 8 hex chars of SHA-256 over the raw key bytes."""
    return hashlib.sha256(_decode_key(key_b64)).hexdigest()[:8]


def is_envelope(value: object) -> bool:
    """Cheap structural check — true for strings shaped like an envelope."""
    return (
        isinstance(value, str)
        and value.startswith(f"{_PREFIX}:{_VERSION}:")
        and value.count(":") == 5
    )


@dataclass(frozen=True)
class ParsedEnvelope:
    fingerprint: str
    iv: bytes
    ciphertext: bytes
    tag: bytes


def parse_envelope(envelope: str) -> ParsedEnvelope:
    """Split an envelope into its parts; raises VaultFormatError on bad shape."""
    segments = envelope.split(":")
    if len(segments) != 6 or segments[0] != _PREFIX or segments[1] != _VERSION:
        raise VaultFormatError("value is not a vault envelope")
    _, _, fingerprint, iv_b64, ct_b64, tag_b64 = segments
    if not _FINGERPRINT_RE.match(fingerprint):
        raise VaultFormatError("envelope key fingerprint is malformed")
    iv = _decode_segment(iv_b64)
    tag = _decode_segment(tag_b64)
    if len(iv) != _IV_BYTES or len(tag) != _TAG_BYTES:
        raise VaultFormatError("envelope iv/tag length is wrong")
    return ParsedEnvelope(
        fingerprint=fingerprint, iv=iv, ciphertext=_decode_segment(ct_b64), tag=tag
    )


def encrypt_field(
    plaintext: str,
    *,
    organization_id: str,
    credential_id: str,
    field: str,
    key_b64: str,
) -> str:
    """Seal one field value for one credential row."""
    key = _decode_key(key_b64)
    iv = os.urandom(_IV_BYTES)
    sealed = AESGCM(key).encrypt(
        iv, plaintext.encode(), _aad(organization_id, credential_id, field)
    )
    ciphertext, tag = sealed[:-_TAG_BYTES], sealed[-_TAG_BYTES:]
    return ":".join(
        (
            _PREFIX,
            _VERSION,
            key_fingerprint(key_b64),
            base64.b64encode(iv).decode(),
            base64.b64encode(ciphertext).decode(),
            base64.b64encode(tag).decode(),
        )
    )


def decrypt_field(
    envelope: str,
    *,
    organization_id: str,
    credential_id: str,
    field: str,
    key_b64: str,
    previous_key_b64: str | None = None,
) -> str:
    """Open an envelope, accepting the previous key during a rotation."""
    parsed = parse_envelope(envelope)
    candidate: str | None = None
    if key_fingerprint(key_b64) == parsed.fingerprint:
        candidate = key_b64
    elif previous_key_b64 is not None and key_fingerprint(previous_key_b64) == parsed.fingerprint:
        candidate = previous_key_b64
    if candidate is None:
        raise VaultKeyUnknownError(parsed.fingerprint)

    try:
        plaintext = AESGCM(_decode_key(candidate)).decrypt(
            parsed.iv,
            parsed.ciphertext + parsed.tag,
            _aad(organization_id, credential_id, field),
        )
    except InvalidTag as error:
        raise VaultDecryptError() from error
    return plaintext.decode()
