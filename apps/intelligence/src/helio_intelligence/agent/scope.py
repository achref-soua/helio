"""The authenticated tenant scope for a copilot session.

The organization and workspace come from the trusted caller (the BFF
authenticates the user and passes the verified ids) — never from the
model. Tool arguments may shape *what* is asked, but never *whose* data
is read.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OrgScope:
    organization_id: str
    workspace_id: str
