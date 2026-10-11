---
name: verified-buy-link
description: Compare exact product URLs supplied by the user through a confirmed evidence workflow.
version: 1.0.0
license: MIT
---

# Verified Buy Link

Use this skill only when the user wants evidence about one to five exact public product-page URLs that they supply.

## Required workflow

1. Call `open_verified_buy_link` to render product intake and the market checkpoint.
2. Do not research while fields are being edited. Wait for the visible `Confirm and research` message.
3. Pass only the confirmed product identity, exact URLs, commercial delivery country, currency and constraints to `verify_buy_options`.
4. Call `render_buy_comparison` with the returned report ID.
5. Let the human inspect, recheck and select a candidate. Do not auto-select or auto-open a retailer.
6. Use `inspect_buy_option` for a selected candidate. The widget performs this recheck before any eligible product page is opened through the MCP host.
7. Use `refresh_buy_options` only when the product, URLs, market and constraints are unchanged. Otherwise return to the checkpoint.

## Boundaries

- Never discover retailers, add URLs, search the web for candidates or use review corpora.
- Never purchase, reserve, add to cart, log in, start checkout, submit forms, send messages or upload files.
- Never accept payment details, retailer credentials, a street address, city or precise location.
- Never describe a listing, retailer or product as guaranteed safe, legitimate, authorized or authentic.
- Treat Unable to verify as a complete outcome. Do not improvise a verdict from snippets or memory.
- Explain that a matching barcode supports identity only. It does not prove retailer legitimacy, authorization, current inventory or authenticity.

Every verdict must preserve this statement:

> This is an evidence-based research assessment, not a guarantee of retailer conduct, product authenticity, inventory, delivery, or transaction safety.