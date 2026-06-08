"""Tenant-scoped domain data access for the copilot.

Every read is bound to one organization via Postgres row-level security
(the same ``app.org_id`` mechanism the TypeScript services use), so the
copilot can never reach another tenant's data — enforced by the
database, not by query discipline.
"""

from .db import Database, ScopedConnection
from .repository import OrgRepository, WorkspaceSummary

__all__ = ["Database", "ScopedConnection", "OrgRepository", "WorkspaceSummary"]
