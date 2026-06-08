from __future__ import annotations

import json as jsonlib
from collections.abc import Callable

import httpx
import pytest

from helio_sdk import HelioApiError, HelioClient

Handler = Callable[[httpx.Request], httpx.Response]


def make_client(handler: Handler) -> HelioClient:
    # base_url has a trailing slash to verify it is stripped.
    return HelioClient(
        api_key="hk_org.secret",
        base_url="https://api.test/",
        transport=httpx.MockTransport(handler),
    )


def test_requires_api_key_and_base_url() -> None:
    with pytest.raises(ValueError, match="api_key"):
        HelioClient(api_key="", base_url="https://api.test")
    with pytest.raises(ValueError, match="base_url"):
        HelioClient(api_key="hk_x.y", base_url="")


def test_create_contact_sets_headers_and_body() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(201, json={"id": "contact_1", "email": "jane@example.com"})

    with make_client(handler) as helio:
        contact = helio.create_contact(
            workspace_id="ws_1", email="jane@example.com", idempotency_key="idem-1"
        )

    assert contact["id"] == "contact_1"
    req = seen["req"]
    assert req.method == "POST"
    assert str(req.url) == "https://api.test/v1/contacts"  # no double slash
    assert req.headers["authorization"] == "Bearer hk_org.secret"
    assert req.headers["idempotency-key"] == "idem-1"
    assert jsonlib.loads(req.content) == {"workspaceId": "ws_1", "email": "jane@example.com"}


def test_list_contacts_builds_query() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(200, json={"data": [], "nextCursor": None})

    with make_client(handler) as helio:
        page = helio.list_contacts(workspace_id="ws_1", limit=25)

    assert page["nextCursor"] is None
    url = seen["req"].url
    assert url.path == "/v1/contacts"
    assert url.params["workspaceId"] == "ws_1"
    assert url.params["limit"] == "25"
    assert "search" not in url.params


def test_update_contact_distinguishes_clear_from_omit() -> None:
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(jsonlib.loads(request.content))
        return httpx.Response(200, json={"id": "contact_1"})

    with make_client(handler) as helio:
        helio.update_contact("contact_1", first_name=None, status="UNSUBSCRIBED")
        helio.update_contact("contact_1", last_name="Doe")

    assert bodies[0] == {"firstName": None, "status": "UNSUBSCRIBED"}  # None clears
    assert bodies[1] == {"lastName": "Doe"}  # first_name omitted entirely


def test_delete_returns_none_on_204() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with make_client(handler) as helio:
        assert helio.delete_contact("contact_1") is None


def test_path_segments_are_encoded() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(200, json={"id": "x"})

    with make_client(handler) as helio:
        helio.get_contact("a/b c")

    assert seen["req"].url.raw_path == b"/v1/contacts/a%2Fb%20c"


def test_list_member_management() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"added": 2})
        return httpx.Response(204)

    with make_client(handler) as helio:
        result = helio.add_list_members("list_1", ["c1", "c2"])
        helio.remove_list_member("list_1", "c1")

    assert result["added"] == 2
    assert jsonlib.loads(seen[0].content) == {"contactIds": ["c1", "c2"]}
    assert seen[1].method == "DELETE"
    assert seen[1].url.path == "/v1/lists/list_1/members/c1"


def test_workspaces_and_lists_crud() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        route = (request.method, request.url.path)
        if route == ("GET", "/v1/workspaces"):
            return httpx.Response(200, json=[{"id": "ws_1"}])
        if route == ("POST", "/v1/workspaces"):
            return httpx.Response(201, json={"id": "ws_2"})
        if route == ("GET", "/v1/lists"):
            return httpx.Response(200, json={"data": [{"id": "list_1"}], "nextCursor": "list_1"})
        if route == ("POST", "/v1/lists"):
            return httpx.Response(201, json={"id": "list_1", "name": "VIP"})
        if route == ("GET", "/v1/lists/list_1"):
            return httpx.Response(200, json={"id": "list_1", "memberCount": 3})
        if route == ("DELETE", "/v1/lists/list_1"):
            return httpx.Response(204)
        return httpx.Response(500, json={"status": 500, "title": "unexpected route", "type": "x"})

    with make_client(handler) as helio:
        assert helio.list_workspaces()[0]["id"] == "ws_1"
        assert helio.create_workspace(name="Prod", slug="prod")["id"] == "ws_2"
        assert helio.list_lists(workspace_id="ws_1")["nextCursor"] == "list_1"
        assert helio.create_list(workspace_id="ws_1", name="VIP")["id"] == "list_1"
        assert helio.get_list("list_1")["memberCount"] == 3
        assert helio.delete_list("list_1") is None


def test_error_carries_problem_document() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "type": "urn:helio:problem:http_409",
                "title": "conflict",
                "status": 409,
                "detail": "a contact with this email already exists",
            },
        )

    with make_client(handler) as helio, pytest.raises(HelioApiError) as excinfo:
        helio.create_contact(workspace_id="ws_1", email="a@b.com")

    error = excinfo.value
    assert error.status == 409
    assert error.type == "urn:helio:problem:http_409"
    assert error.detail == "a contact with this email already exists"


def test_error_tolerates_non_json_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="gateway down")

    with make_client(handler) as helio, pytest.raises(HelioApiError) as excinfo:
        helio.list_workspaces()

    assert excinfo.value.status == 502
