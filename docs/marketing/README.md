# Marketing & discoverability

Drafts and a checklist for getting Helio noticed. Publish under the
owner's own byline; nothing here is automated.

## Files

- [`medium-article.md`](./medium-article.md) — a launch article. Set its
  canonical link to the GitHub repo so authority accrues to the repo.
- [`linkedin-post.md`](./linkedin-post.md) — a launch post. Put the repo
  link in the first comment (pinned), not the body.

## Why "Helio" alone is hard, and what actually works

"Helio" is a common word (sun-related brands, a crypto project, others),
so ranking #1 for the bare term is a long game. What ranks fast and
brings the _right_ people:

- **"helio marketing automation"**, **"open-source marketing automation
  self-hosted"**, **"HubSpot alternative open source"** — the repo, the
  docs site, and these articles all target these phrases.
- **Your name + the project** — a Medium article and a LinkedIn post
  under your byline rank for "Achref Soua Helio" almost immediately and
  are what people who hear about it will actually search.

## One-time checklist

- [x] GitHub repo topics set (marketing-automation, open-source,
      self-hosted, hubspot-alternative, …).
- [x] Repo description is keyword-rich.
- [x] Docs site ships OpenGraph + Twitter cards, a Schema.org
      `SoftwareApplication` JSON-LD block, `sitemap.xml`, and `robots.txt`
      (set `HELIO_DOCS_URL` to the deployed origin so they resolve).
- [ ] Deploy the docs site and submit `sitemap.xml` to
      [Google Search Console](https://search.google.com/search-console)
      and [Bing Webmaster Tools](https://www.bing.com/webmasters).
- [ ] Set the repo's **Website** field to the docs URL once deployed.
- [ ] Publish the Medium article (canonical → repo) and the LinkedIn post.
- [ ] Add Helio to listings that rank well and send real traffic:
      [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted),
      AlternativeTo (as a HubSpot/Mautic alternative), Product Hunt,
      and the r/selfhosted and r/opensource communities.
- [ ] A short demo video on YouTube titled for the search phrases above
      (the description should link the repo) — video results show up in
      Google and YouTube is itself the #2 search engine.
