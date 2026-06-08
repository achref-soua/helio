"""Typed client for the Helio public REST API."""

from __future__ import annotations

from typing import Any, cast
from urllib.parse import quote

import httpx

from helio_sdk.errors import HelioApiError
from helio_sdk.models import (
    AddMembersResult,
    Contact,
    ContactList,
    ContactPage,
    ContactStatus,
    ListPage,
    Workspace,
)

# Sentinel distinguishing "omitted" (leave unchanged) from None (clear) on
# PATCH. Typed Any so it is assignable to the optional string parameters.
_UNSET: Any = object()


class HelioClient:
    """A small, typed wrapper over the Helio gateway.

    The API key grants full organization access, so use this **server-side**;
    never ship it to a browser. Usable as a context manager so the underlying
    connection pool is closed on exit::

        with HelioClient(api_key=key, base_url=url) as helio:
            helio.create_contact(workspace_id="ws_...", email="jane@example.com")
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("HelioClient: api_key is required")
        if not base_url:
            raise ValueError("HelioClient: base_url is required")
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"authorization": f"Bearer {api_key}"},
            timeout=timeout,
            transport=transport,
        )

    def __enter__(self) -> HelioClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._client.close()

    # ── Workspaces ──────────────────────────────────────────────────────
    def list_workspaces(self) -> list[Workspace]:
        return cast(list[Workspace], self._request("GET", "/v1/workspaces"))

    def create_workspace(
        self, *, name: str, slug: str, idempotency_key: str | None = None
    ) -> Workspace:
        return cast(
            Workspace,
            self._request(
                "POST",
                "/v1/workspaces",
                json={"name": name, "slug": slug},
                idempotency_key=idempotency_key,
            ),
        )

    # ── Contacts ────────────────────────────────────────────────────────
    def list_contacts(
        self,
        *,
        workspace_id: str | None = None,
        list_id: str | None = None,
        search: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> ContactPage:
        params = _drop_none(
            {
                "workspaceId": workspace_id,
                "listId": list_id,
                "search": search,
                "limit": limit,
                "cursor": cursor,
            }
        )
        return cast(ContactPage, self._request("GET", "/v1/contacts", params=params))

    def create_contact(
        self,
        *,
        workspace_id: str,
        email: str,
        first_name: str | None = None,
        last_name: str | None = None,
        attributes: dict[str, str] | None = None,
        status: ContactStatus | None = None,
        idempotency_key: str | None = None,
    ) -> Contact:
        body = _drop_none(
            {
                "workspaceId": workspace_id,
                "email": email,
                "firstName": first_name,
                "lastName": last_name,
                "attributes": attributes,
                "status": status,
            }
        )
        return cast(
            Contact,
            self._request("POST", "/v1/contacts", json=body, idempotency_key=idempotency_key),
        )

    def get_contact(self, contact_id: str) -> Contact:
        return cast(Contact, self._request("GET", f"/v1/contacts/{_seg(contact_id)}"))

    def update_contact(
        self,
        contact_id: str,
        *,
        first_name: str | None = _UNSET,
        last_name: str | None = _UNSET,
        attributes: dict[str, str] | None = None,
        status: ContactStatus | None = None,
        idempotency_key: str | None = None,
    ) -> Contact:
        # None clears the field; an omitted argument leaves it unchanged.
        body: dict[str, object] = {}
        if first_name is not _UNSET:
            body["firstName"] = first_name
        if last_name is not _UNSET:
            body["lastName"] = last_name
        if attributes is not None:
            body["attributes"] = attributes
        if status is not None:
            body["status"] = status
        return cast(
            Contact,
            self._request(
                "PATCH",
                f"/v1/contacts/{_seg(contact_id)}",
                json=body,
                idempotency_key=idempotency_key,
            ),
        )

    def delete_contact(self, contact_id: str) -> None:
        self._request("DELETE", f"/v1/contacts/{_seg(contact_id)}")

    # ── Lists ───────────────────────────────────────────────────────────
    def list_lists(
        self,
        *,
        workspace_id: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> ListPage:
        params = _drop_none({"workspaceId": workspace_id, "limit": limit, "cursor": cursor})
        return cast(ListPage, self._request("GET", "/v1/lists", params=params))

    def create_list(
        self, *, workspace_id: str, name: str, idempotency_key: str | None = None
    ) -> ContactList:
        return cast(
            ContactList,
            self._request(
                "POST",
                "/v1/lists",
                json={"workspaceId": workspace_id, "name": name},
                idempotency_key=idempotency_key,
            ),
        )

    def get_list(self, list_id: str) -> ContactList:
        return cast(ContactList, self._request("GET", f"/v1/lists/{_seg(list_id)}"))

    def delete_list(self, list_id: str) -> None:
        self._request("DELETE", f"/v1/lists/{_seg(list_id)}")

    def add_list_members(
        self, list_id: str, contact_ids: list[str], *, idempotency_key: str | None = None
    ) -> AddMembersResult:
        return cast(
            AddMembersResult,
            self._request(
                "POST",
                f"/v1/lists/{_seg(list_id)}/members",
                json={"contactIds": contact_ids},
                idempotency_key=idempotency_key,
            ),
        )

    def remove_list_member(self, list_id: str, contact_id: str) -> None:
        self._request("DELETE", f"/v1/lists/{_seg(list_id)}/members/{_seg(contact_id)}")

    # ── Internals ───────────────────────────────────────────────────────
    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        idempotency_key: str | None = None,
    ) -> Any:
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        response = self._client.request(method, path, params=params, json=json, headers=headers)
        if response.status_code >= 400:
            raise _to_error(response)
        if response.status_code == 204:
            return None
        return response.json()


def _seg(value: str) -> str:
    """Percent-encode a single URL path segment."""
    return quote(value, safe="")


def _drop_none(values: dict[str, Any]) -> dict[str, Any]:
    """Drop keys whose value is None (so the server applies its defaults)."""
    return {key: value for key, value in values.items() if value is not None}


def _to_error(response: httpx.Response) -> HelioApiError:
    """Build a HelioApiError from a response, tolerating non-problem bodies."""
    status = response.status_code
    type_ = f"urn:helio:problem:http_{status}"
    title = response.reason_phrase or "request failed"
    detail: str | None = None
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        type_ = str(body.get("type", type_))
        title = str(body.get("title", title))
        raw_status = body.get("status")
        if isinstance(raw_status, int):
            status = raw_status
        if body.get("detail") is not None:
            detail = str(body["detail"])
    return HelioApiError(status=status, type=type_, title=title, detail=detail)
