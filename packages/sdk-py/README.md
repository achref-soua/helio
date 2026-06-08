# helio-sdk (Python)

Helio's Python SDK — a typed client for the public REST API. Built on
[`httpx`](https://www.python-httpx.org/), managed with [`uv`](https://docs.astral.sh/uv/).

## Install

```bash
uv add helio-sdk   # or: pip install helio-sdk
```

## Usage

```python
from helio_sdk import HelioApiError, HelioClient

with HelioClient(
    api_key="hk_<org>.<secret>",  # Settings → API keys; server-side only
    base_url="https://api.your-helio.example",
) as helio:
    contact = helio.create_contact(
        workspace_id="ws_...",
        email="jane@example.com",
        first_name="Jane",
        idempotency_key="...",
    )

    vips = helio.create_list(workspace_id="ws_...", name="VIPs")
    helio.add_list_members(vips["id"], [contact["id"]])

    # Cursor pagination.
    cursor: str | None = None
    while True:
        page = helio.list_contacts(workspace_id="ws_...", cursor=cursor)
        for c in page["data"]:
            print(c["email"])
        cursor = page["nextCursor"]
        if cursor is None:
            break

    try:
        helio.get_contact("contact_missing")
    except HelioApiError as error:
        print(error.status, error.type, error.detail)
```

Resources: `list_workspaces` / `create_workspace`; `list_contacts` /
`create_contact` / `get_contact` / `update_contact` / `delete_contact`;
`list_lists` / `create_list` / `get_list` / `delete_list` /
`add_list_members` / `remove_list_member`.

## Notes

- The API key grants full organization access — keep it **server-side**.
- Responses are typed `TypedDict`s matching the API's JSON (camelCase keys).
- `update_contact(..., first_name=None)` clears a field; omitting the
  argument leaves it unchanged.
- Every non-2xx response raises `HelioApiError` carrying the RFC 9457
  problem document (`status`, `type`, `title`, `detail`).

## Development

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
```
