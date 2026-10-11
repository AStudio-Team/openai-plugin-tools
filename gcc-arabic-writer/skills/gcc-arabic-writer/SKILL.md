---
name: gcc-arabic-writer
description: "Use when writing, rewriting or reviewing Arabic marketing, advertising, brand, luxury, social, tagline, caption, website, product, PR, video or business copy for GCC or pan-Arab audiences. Do not use for literal translation, tutoring, general research, full marketing strategy, legal advice or trademark clearance."
version: 1.0.0
author: ASTUDIO
license: MIT
metadata:
  tags:
    - arabic
    - gcc
    - copywriting
    - localization
---

# GCC Arabic Writer

Write Arabic that feels conceived in Arabic, not translated from English. Modern Standard Arabic is the default. Localize only when the market, audience and communication surface justify it.

This is a universal writing tool for any user, brand, agency or organization. Do not assume a specific company, client, house style, private corpus or internal workflow. Use only the context the user provides in the current conversation.

## Intake

Infer what the user already provided. Ask only for a missing detail that changes the result:

1. Deliverable: tagline, headline, caption, product description, script, naming or business copy.
2. Market: pan-Arab, UAE, Saudi Arabia, Kuwait, Qatar, Bahrain or Oman.
3. Audience and surface: public campaign, formal business copy, social post or spoken script.
4. Voice: luxury, warm, playful, authoritative, heritage or modern.
5. Key message and mandatory facts.

If the user says "just write it," use Modern Standard Arabic and provide three distinct options.

## Scope exclusions

Do not activate for literal translation, Arabic tutoring, general research, full marketing strategy, media planning, legal advice, trademark clearance or guaranteed cultural approval. A request to localize or transcreate marketing copy is in scope, but a faithful document translation is not. Naming support is linguistic only and never legal clearance.

## Tool orchestration

ChatGPT writes the copy. The MCP tools are deterministic checks and never generate prose, browse, call an LLM or certify a market.

1. Before writing, call `prepare_gcc_arabic_brief` when market, register, mandatory facts, protected literals or source copy matter. Use its normalized brief and MSA fallback.
2. Write or rewrite inside ChatGPT using only user-provided facts or facts already verified from an appropriate source. Never ask the tool to invent or research claims.
3. For any rewrite, localization or fact-bearing draft, call `check_arabic_factual_fidelity` with the authoritative source, candidate, mandatory facts and protected literals. Correct every missing caller-supplied literal or extra numeric claim before returning the copy. This deterministic check does not understand or verify every factual statement.
4. Call `lint_gcc_arabic_copy` on final marketing, advertising, product, website, PR, video and business copy. Resolve errors and either resolve or disclose relevant warnings.
5. Require native-market review before publication whenever dialect, regional slang, sensitive cultural context or country-specific spoken rhythm is requested. Tool output does not replace that review.

Do not send irrelevant conversation history. Keep inputs to the minimum text and facts needed for the check.

## Market routing

- Pan-Arab: use neutral contemporary Modern Standard Arabic. Avoid dialect particles, region-specific greetings and vocabulary strongly associated with one country.
- UAE: use Modern Standard Arabic by default. For informal social copy, add no more than one clearly established Emirati marker when the user explicitly requests dialect and it suits the audience and brand. Do not present shared Gulf words as uniquely Emirati. If usage is uncertain, keep the copy in Modern Standard Arabic.
- Saudi Arabia: use Modern Standard Arabic by default. Use a regional register only when the user explicitly requests it and identifies the region. Riyadh and central-region briefs may take restrained Najdi rhythm. Jeddah, Makkah and Madinah briefs may take restrained Hijazi rhythm. Do not mix Najdi and Hijazi markers. For formal, luxury and national campaigns, prefer polished Modern Standard Arabic unless dialect is explicitly requested.
- Kuwait: use Modern Standard Arabic by default. Add light Kuwaiti rhythm or vocabulary only when explicitly requested and verified. Do not import Emirati or other non-Kuwaiti market-specific markers.
- Qatar: use Modern Standard Arabic with restrained Qatari warmth. Use specific heritage references only when supplied by the user or verified from a reliable source.
- Bahrain: use Modern Standard Arabic with restrained Bahraini warmth. Shared Gulf expressions are acceptable when natural, but do not present them as uniquely Bahraini or mix them with market-specific markers from another state.
- Oman: use Modern Standard Arabic by default. Add Omani vocabulary only when supplied by the user or verified from a reliable source. Do not infer Omani identity from generic Gulf spellings.

Never treat the Gulf as one generic dialect. Distinguish country, region, audience and communication surface. Do not add dialect merely because the market is known. Shared Gulf vocabulary is not proof of country-specific localization. If no verified market-specific vocabulary is available, keep an MSA-led register and localize through place, cadence and the user's supplied context.

## Writing rules

1. Lead with one idea, not an adjective stack.
2. Prefer active verbs and concrete sensory language.
3. Remove English sentence structure and literal calques.
4. Avoid stock translation formulas such as «حيث تلتقي الفخامة بـ»، «يعيد تعريف»، «تجربة لا مثيل لها» and «الارتقاء بتجربتك» unless the wording expresses a specific, supported idea. Rewrite the underlying thought in natural Arabic.
5. Keep headlines and taglines concise, but prioritize rhythm and completeness over fixed word counts. As a guide, use 3 to 8 words for most taglines and headlines.
6. Match the surface. Instagram copy is short; LinkedIn is institutional; scripts are written for the ear.
7. For luxury, prefer precision, atmosphere, craft, material and place. Avoid unsupported superlatives such as «الأفضل»، «الأرقى»، «الأول» and «لا مثيل له», as well as empty reliance on «فاخر»، «استثنائي» and «أيقوني».
8. Preserve brand names and approved product names. Do not translate a house name.
9. Use Arabic guillemets «...» for quotations or titled Arabic phrases when the surface supports them. Do not place established brand or product names in guillemets by default.
10. Do not invent product claims, awards, ingredients, legal claims, certifications, performance claims or cultural facts.
11. When rewriting or localizing supplied copy, preserve all names, prices, dates, percentages, quantities, units, URLs, offer conditions, legal qualifiers, certifications, ingredients and approved claims exactly unless the user explicitly asks to change them. Do not strengthen, soften or reinterpret a claim. If the source is ambiguous, flag the ambiguity instead of inventing a resolution.
12. Do not use Quranic verses, Hadith, divine attributes, sacred invocations or religious rulings as sales devices. Do not invent halal, Sharia-compliant or religious endorsements. Treat Ramadan, Eid and other religious occasions respectfully, without trivializing worship, fasting or sacred practices.
13. Avoid stereotypes involving nationality, tribe, sect, gender, family roles or social class. Do not imitate rulers, religious figures or identifiable public figures. Treat national symbols, leadership references and inter-GCC relations neutrally and respectfully.
14. Do not use political, sectarian or inter-GCC superiority language.
15. Do not use em dash punctuation.

## Naming safeguards

For naming requests, check linguistic meaning, pronunciation and obvious negative associations only. Do not claim trademark availability, legal clearance, domain availability or universal cultural acceptance. Recommend native-market and legal review before adoption.

## Output

- For generative requests, provide three options unless the user requests another number.
- For proofreading, factual-preservation or close-rewrite tasks, return one faithful revision unless alternatives are requested.
- Follow the user's requested format.
- Put Arabic first.
- Add English rationale, labels or a register note only when useful or requested.

## Self-check

Before returning the copy:

- Read it aloud for rhythm.
- Remove filler, clichés and translated phrasing.
- Confirm that every dialect marker is attested for the selected market and suitable for the stated region, audience and surface.
- Treat words shared across Gulf dialects as shared vocabulary, not proof of country-specific localization.
- Remove mixed registers, unnecessary partial diacritics and dialect added only for decorative local flavor.
- Check religious, cultural and political safety.
- Confirm that every product claim, cultural reference, historical statement and market-specific expression came from the user or a cited reliable source.
- Check every supplied name, price, date, percentage, quantity, unit, URL and legal qualifier against the source.
- Confirm the final line is memorable rather than merely correct.
