# I built Helio: an open-source, AI-native alternative to HubSpot you can self-host

_Draft for Medium. Publish under your own byline. Suggested tags: Open Source, Marketing Automation, Self Hosting, TypeScript, AI. Suggested canonical: link back to the GitHub repository so the repo accrues the authority._

---

Marketing automation has a strange shape. The good tools — HubSpot, Customer.io, Klaviyo — are excellent and closed, and they bill you per contact until the spreadsheet hurts. The open tools — Mautic, Listmonk — are either heavy and aging or deliberately narrow. None of them are built for 2026: AI-native, fast, and yours.

So I built **Helio**: an open-source, self-hostable, AI-native marketing-automation and customer-engagement platform. It's free forever, it runs on infrastructure you own, and it doesn't phone home.

**Repository: https://github.com/achref-soua/helio**

## What it does

Helio is a complete growth platform, not a newsletter tool wearing a suit:

- **Customer data platform** — unified contact profiles, arbitrary traits, a full event timeline, B2B company objects, and GDPR export/erase built in.
- **Segmentation** — a visual builder over behavior, attributes, lead score, and AI predictions, plus natural-language → segment.
- **Journeys on a real workflow engine** — the visual canvas executes on Temporal, so a multi-week journey survives a worker restart with no lost state and no double-sends.
- **Email** — a block builder with live preview and device image uploads, personalization tokens, A/B testing, open/click tracking, one-click unsubscribe, and a deliverability wizard that sets up SPF/DKIM/DMARC.
- **Multi-channel** — SMS, WhatsApp, web push, on-site widgets, in-app messages, and landing pages.
- **AI copilot** — describe a segment, a journey, or an on-brand email in a sentence and get a working draft you can preview before saving. Bring your own model — including a fully local one, so nothing leaves your network.
- **Analytics** — dashboards, funnels, cohorts, multi-touch attribution, and a SQL explorer over ClickHouse.
- **CRM-lite** — pipelines, a deal board and table, tasks, and a meeting scheduler.

## Why it's different

**It's AI-native, not AI-bolted-on.** The copilot turns plain English into validated segments and journeys, and it shows you exactly what it built before you commit.

**Durable by construction.** Journeys run on Temporal. Crashes, restarts, and multi-week waits don't lose state — the failure mode that quietly burns trust in every homegrown automation system simply isn't there.

**You own the data.** No telemetry, no per-contact billing, no vendor lock. A default install sends data to nobody; every integration you add is an explicit choice.

**Modern stack.** Next.js, TypeScript, a Python intelligence plane, PostgreSQL with row-level-security tenant isolation, ClickHouse for analytics, Redis, and a one-command Docker install.

## Try it

```bash
# One command, on any machine with Docker:
helio install
```

A first-run wizard sets up your admin, organization, and workspace, and seeds a demo workspace with four weeks of data so every chart and journey is populated from your first sign-in.

The whole thing is AGPL-3.0. Star it, fork it, run it, and tell me what's missing:

**https://github.com/achref-soua/helio**

— Achref Soua
