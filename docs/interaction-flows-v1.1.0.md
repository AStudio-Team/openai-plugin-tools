# Human Interaction Flow Specification

Version: 1.1.0
Status: local next version only
Date: 2026-10-11

This specification defines the human interaction contract for the next local versions of GCC Arabic Writer and PDF Table to Excel. It does not claim that version 1.1.0 is uploaded, submitted, approved or published. The prior versions may remain in portal review while this branch is tested.

## Shared MCP Apps architecture

- Tools and `ui://` resources are registered separately.
- Tool metadata links to the resource through `_meta.ui.resourceUri`.
- Every resource uses `text/html;profile=mcp-app` through `RESOURCE_MIME_TYPE`.
- The pinned `@modelcontextprotocol/ext-apps` app-with-deps bundle is inlined at service startup. Widgets load no remote scripts.
- Resource CSP allowlists for connections, resources, frames and base URIs are empty.
- Widgets use automatic resizing, host theme context, safe-area insets, native controls, visible focus states, responsive single-column layouts and status announcements.
- Widget actions use `app.sendMessage`. Download navigation uses `app.openLink`. Widgets do not use direct popup or top-level navigation.
- Widgets are additive. Every tool remains useful through human-readable `content` and validated `structuredContent` when a host does not render apps.

## GCC Arabic Writer

### Entry intent

The user asks to write, rewrite, localize, proofread or review Arabic marketing or business copy for a GCC or pan-Arab audience.

### Intake

`prepare_gcc_arabic_brief` accepts the requested deliverable, market, audience, surface, voice or register, dialect request, key message, source text, mandatory facts, protected literals and constraints. Missing optional values receive deterministic defaults. MSA and pan-Arab remain the safe defaults.

### Human checkpoint

The brief builder renders the normalized brief as an editable, focused form. The person can review and edit:

- deliverable
- market
- audience
- surface
- voice or register
- key message
- source text, displayed read-only and preserved byte-for-byte for rewrite and localization approval
- mandatory facts
- protected literals
- dialect request
- constraints

The service does not generate copy. The widget does not silently submit or update hidden model context. The person must press **Send reviewed brief**, which visibly sends the reviewed brief into chat through `app.sendMessage`.

### Execution

After the visible approval message, ChatGPT writes the requested options using the reviewed brief. The existing deterministic process remains available without widgets: prepare the brief, show its complete text summary, obtain approval in chat, write options, run fidelity where facts matter, and run lint.

### Result

`check_arabic_factual_fidelity` and `lint_gcc_arabic_copy` attach a read-only review app. It shows pass or revision status, deterministic findings, metrics and the scope limitation.

### Human choice

The review app offers two visible choices:

1. Ask for a revision that addresses the findings while preserving approved facts and literals.
2. Keep the current option while restating remaining warnings and review requirements.

### Follow-up

The visible message sent by either choice returns control to chat. The user can request another option, change the brief, narrow the register or approve a revised option.

### Fallback

If widgets do not render, the brief tool returns a readable summary with an explicit approval instruction. Fidelity and lint tools return readable findings with an explicit revision or keep path. Validated structured data remains available to the host and model.

### Cancellation

The brief app provides **Cancel request**. It visibly sends a cancellation message and instructs the host not to generate copy from the brief. A user can also cancel in plain chat.

### Privacy

The widget sends only the fields visible in the reviewed form. It does not browse, call a third-party service, use browser storage or silently add context. The MCP service remains stateless, does not persist submitted brief or copy, and does not log submitted text. Operational logs remain limited to tool name, status, latency, rule count and byte count.

### Dialect control

MSA remains the default. Selecting dialect or a dialect-sensitive register exposes a visible warning that native review from the selected market is required before publication. Automated output never claims native-market certification.

## PDF Table to Excel

### Entry intent

The user asks to extract selectable tables from an attached or selected PDF into an XLSX workbook.

### Intake

The host provides the selected file through the existing OpenAI file parameter. The widget does not implement a duplicate file picker. The service accepts one PDF per call and an optional output filename.

### Human checkpoint

The host-mediated upload is the intake choice. Conversion begins only after the user attaches or selects a PDF and asks for conversion. There is no hidden upload or autonomous file selection.

### Execution

The service verifies HTTPS and public address resolution for the host-provided temporary URL, enforces input and resource limits, validates the PDF signature, extracts selectable tables, neutralizes formula-like cell text, validates the generated XLSX and stores the workbook temporarily in memory.

### Result

`convert_pdf_tables_to_excel` attaches a read-only result app showing:

- output filename
- pages processed
- table count
- worksheet name, source page, row count and column count
- up to five extracted sample rows per table
- temporary link expiry

The app does not imitate or claim to be an editable spreadsheet.

### Human choice

The person can:

1. Download through the host using `app.openLink` on the verified output URL.
2. Send a visible request to rename the workbook.
3. Send a visible request to inspect a worksheet.
4. Send a visible request to convert another PDF.

### Follow-up

Rename asks ChatGPT to request the new filename and reconvert only if the host still has access to the same PDF. Inspect asks which worksheet to review. Convert another asks the user to upload or select a new PDF before another tool call.

### Fallback

If the app does not render, the tool returns a readable result with filename, page count, table count, worksheet summary, verified temporary download URL, expiry and the same follow-up choices. Validated structured data includes the sample rows.

### Cancellation

The user can cancel before conversion by not supplying a PDF or by withdrawing the request in chat. After conversion, no further action occurs unless the user presses a result action or sends another message. Temporary output expires automatically.

### Privacy

Only the explicitly selected PDF, temporary host URL, file metadata and requested filename are processed. Input bytes are handled in working memory. Generated workbook bytes are kept in server memory for no more than 15 minutes and removed by periodic expiry. The widget receives result metadata and sample rows already returned by the conversion tool. It makes no direct network request; the host mediates opening the verified temporary download URL.

## Interaction test matrix

### GCC Arabic Writer

| Type | Prompt or action | Expected behavior |
| --- | --- | --- |
| Direct | "Write three Saudi MSA captions" | Prepare brief, render review form, wait for explicit send, then write. |
| Direct | Rewrite fact-bearing UAE copy | Preserve source, facts and literals, then show fidelity and lint review. |
| Indirect | "Make this sound natural for Riyadh" | Treat as localization, default to MSA unless dialect is explicit. |
| Indirect | "Polish this Arabic product page" | Infer rewrite, collect only missing decision-changing fields. |
| Incomplete | No market supplied | Default to pan-Arab and MSA, show both in review. |
| Incomplete | No key message supplied | Show an empty editable key-message field and do not invent facts. |
| Follow-up | User changes surface in the widget | Send the edited surface in the visible reviewed brief. |
| Follow-up | User asks for one more option | Keep the approved brief and generate one additional option. |
| Revision | Fidelity reports a missing price | Revision action asks ChatGPT to restore the exact protected price. |
| Revision | Lint reports a superlative | Revision action asks ChatGPT to remove or substantiate it. |
| Selection | User presses Keep current option | Chat message keeps it and restates any warnings. |
| Cancellation | User presses Cancel request | Visible cancellation message, no copy generation. |
| Negative | Literal contract translation | Do not activate the writing flow. |
| Negative | Trademark guarantee | Refuse the guarantee and do not imply legal clearance. |
| Boundary | 50 facts at 500 characters each | Accept at schema limits and keep the widget responsive. |
| Boundary | 51 facts or one 501-character fact | Reject through schema validation. |
| Boundary | Dialect-sensitive register without dialect checkbox | Show native-market warning because the register itself is sensitive. |
| Boundary | Widget unavailable | Use text summary, structured data and an explicit chat approval checkpoint. |

### PDF Table to Excel

| Type | Prompt or action | Expected behavior |
| --- | --- | --- |
| Direct | Convert an attached invoice PDF | Use host file input, convert and show result app plus fallback. |
| Direct | Convert all tables and name the file | Sanitize filename, append `.xlsx`, show worksheets and download. |
| Indirect | "Put the tables in this report into separate sheets" | Activate conversion for the attached PDF. |
| Incomplete | Request has no file | Ask for an upload or selection before tool call. |
| Incomplete | File MIME type is absent | Verify the downloaded signature before conversion. |
| Follow-up | Press Ask to rename | Send a visible message asking ChatGPT to request the new name. |
| Follow-up | Press Inspect a worksheet | Send a visible message and ask which worksheet to inspect. |
| Follow-up | Press Convert another PDF | Ask for a new upload before another conversion call. |
| Revision | User corrects requested filename | Reconvert only when the host can still supply the selected PDF. |
| Cancellation | User withdraws before attaching | Do not call the conversion tool. |
| Negative | JPG photograph | Do not invoke conversion. Ask for a PDF. |
| Negative | Image-only scanned PDF | Report that OCR is not included. Do not fabricate rows. |
| Boundary | PDF is exactly 20 MB or below | Accept if all other limits pass. |
| Boundary | PDF exceeds 20 MB | Reject before conversion. |
| Boundary | PDF exceeds 200 pages or 250,000 cells | Reject with the existing bounded error. |
| Boundary | Formula-like extracted text | Store as text, never executable formulas. |
| Boundary | Temporary URL resolves private or non-HTTPS | Reject under SSRF controls. |
| Boundary | Widget unavailable | Return complete result text, structured preview data and URL. |
| Boundary | Download link has expired | Host action fails safely; chat fallback explains reconversion is required. |

## Local acceptance gates

- `tools/list` exposes the expected tool schemas, annotations and `_meta.ui.resourceUri` values.
- `resources/list` and `resources/read` expose every linked app resource with the official MIME type.
- Resource metadata has closed CSP allowlists.
- Inlined resources contain the official app bundle and no remote script tags.
- Brief submit, cancellation, review revision, result follow-up and host-mediated download actions are present and user initiated.
- Tool text is meaningful without widgets, and structured output validates.
- Widgets include mobile layout, dark theme, safe-area handling, keyboard-visible focus, labels and live status announcements.
- Existing security, rate limiting, retention, rollback and live-check behavior remains covered by existing suites.
- Real host sandbox, visual and action tests remain a pre-upload gate and cannot be replaced by local protocol tests.

## Remaining real-host gates

Local protocol, container and package checks do not constitute real-host evidence. Before any upload or portal submission, both apps still require genuine ChatGPT host verification for sandbox rendering, light and dark visual review, mobile resizing, brief send and cancel actions, revision and keep actions, guarded download opening and each follow-up action. The existing demo recording URL and portal state are intentionally unchanged until those checks are completed and a new truthful recording is available.
