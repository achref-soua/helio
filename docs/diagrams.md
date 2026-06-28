# Subsystem diagrams

Every major Helio subsystem, drawn. Sources live in [`docs/diagrams/*.mmd`](./diagrams/)
(Mermaid) and render to committed SVGs in [`docs/assets/diagrams/`](./assets/diagrams/) via
`task diagrams`. The top-level C4 context and container views are in
[`architecture.md`](./architecture.md).

## Data & ingestion

### Event ingestion → ClickHouse

![Event ingestion pipeline](assets/diagrams/ingestion-pipeline.svg)

### CDP identity resolution & merge

![CDP identity resolution](assets/diagrams/cdp-identity-resolution.svg)

### Analytics query pipeline

![Analytics query pipeline](assets/diagrams/analytics-query.svg)

## Segmentation & journeys

### Segmentation — visual builder → SQL

![Segmentation compute](assets/diagrams/segmentation-compute.svg)

### Journey execution on Temporal (durable, no double-send)

![Journey execution](assets/diagrams/journey-execution.svg)

## Delivery

### Multi-channel delivery adapter layer

![Delivery adapters](assets/diagrams/delivery-adapters.svg)

### Outbound webhook delivery (HMAC + durable retry)

![Webhook delivery](assets/diagrams/webhook-delivery.svg)

## Capture — pages, forms, widgets

### Landing pages & forms → CDP

![Landing pages and forms](assets/diagrams/landing-forms.svg)

### On-site widget embed lifecycle

![Widget embed](assets/diagrams/widget-embed.svg)

## AI plane

### Copilot — natural language → segment / journey / content

![AI copilot flow](assets/diagrams/ai-copilot-flow.svg)

### Predictive scoring / churn

![Churn model](assets/diagrams/churn-model.svg)

### MCP server — agent-driven campaigns

![MCP server](assets/diagrams/mcp-server.svg)

## Platform & security

### Multi-tenant isolation (Postgres RLS)

![RLS tenant isolation](assets/diagrams/rls-tenant-isolation.svg)

### Credential vault (encryption at rest)

![Credential vault](assets/diagrams/credential-vault.svg)

### SSO (OIDC / SAML) + SCIM provisioning

![SSO and SCIM](assets/diagrams/sso-scim.svg)

## CRM & operations

### Meeting scheduler

![Meeting scheduler](assets/diagrams/scheduler-meeting.svg)

### Deployment profiles (docker compose)

![Deployment profiles](assets/diagrams/deployment-profiles.svg)
