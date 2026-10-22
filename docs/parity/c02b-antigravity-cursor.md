# c02b — Antigravity providers and CursorClient (sub-audit of c02)

Open: 7 files, 1,295 lines. Counts (51 rows): same 21 · deliberate 1 · better 0 · missing 7 · differs 22 · unclear 0.

## Check of the earlier audit
- "Cursor request-level billing sessions" gap is refuted as written: fetch_events, reconcile_pages, parse_events, resolve_local_names (agents/src/cursor/events.rs and agents/src/cursor/sessions.rs) ingested by ingest_account_sessions.
- Real Cursor gaps: accountWide flag, failure notice, sign-out clearing, coupling to the quota read, local-midnight window, BLOB values, 1 MiB cap.
- Missing Antigravity quota summary (RetrieveUserQuotaSummary) is not listed as a gap anywhere; docs/accounts.md:17 describes GetUserStatus only.

## Missing / differs
| Open | Behavior | Next | Status | What / when / user sees |
|---|---|---|---|---|
| Antigravity/AntigravityClient.swift:46-56,96-131 | Quota from RetrieveUserQuotaSummary (groups, buckets, 5h/weekly durations) | none; method not in allowed() whitelist (clients/antigravity/service.rs:142-154); only GetUserStatus | missing | Rows "Gemini Models"/"Claude and GPT models" without window length; legacy value can be stale → may show 25% used when exhausted |
| AntigravityClient.swift:61-94 | supersededLegacyWindowIDs, summaryNames/compactName | none | missing | Needed once summary is ported |
| AntigravityCLI.swift:10-44 | Fallback `agy -p /usage --output-format json` | none; token-less agy dropped | missing | Terminal-only agy: no Antigravity quota, error text instead |
| AntigravityService.swift:88-108 | Candidate priority CLI=1, Antigravity IDE=2 | clients/antigravity/service.rs:44-81 | differs | Two apps on different accounts → may show the IDE account |
| AntigravityService.swift:27-30,55-68 | Approval discovery remembered 10 s; all listeners of all processes | clients/antigravity/service.rs:176-257 | differs | A second service's approvals never reach the HUD while the first answers |
| AntigravityClient.swift:11-17,43 | Notices for not running / no readable quota | src/crates/agents/src/antigravity/account.rs:109-114,132-145 | differs | Failed reading marks rows stale; different English-only text The notices are bilingual since 2026-10-20; a failed reading still marks rows stale. |
| AntigravityClient.swift:27-31 | Empty legacy fallback is not a reading | src/crates/agents/src/antigravity/account.rs:109-114 | differs | "connected, no percentage" instead of summary windows |
| AntigravityClient.swift:133-159; CursorClient.swift:87-98 | Short labels set in Core | ui hud/model.ts:188-195 regex | fixed | "Claude and GPT" vs "3rd-party"; "Kimi K3" vs "K3"; Cursor "Included usage" vs "Included" etc. **Fixed 2026-10-20** (window names): "3rd-party", the model's word ("K3"), and Cursor's "Included", "First-party", "Third-party", "Spend limit", "Pooled", "On-demand" come from Core. The summary schema's compact names wait for that schema (not read by Next). |
| ProviderData.swift:112-123; ids | legacyWindowId mapping for Cursor/Antigravity rows | not set (only Claude/Codex set it) | differs | First Next run: these rows start with no quota history; legacy visibility/order don't map |
| AntigravityClient.swift:141-144 | Unresolved account key home "" | accounts/mod.rs:92-97 home:<path> | differs | Data only |
| AntigravitySessions.swift:36-84,108 | Title: escapes decoded to bytes then UTF-8; first line ≤60 with …; empty → "Client · stem" | agents/src/../core/src/clients/antigravity.rs:38-104,138-151 | fixed | Non-ASCII titles garbled ("ä½" instead of "你"); long/multi-line titles **Fixed 2026-10-20** (session titles). |
| AntigravitySessions.swift:89-134 | Notice for excluded records | silent skips | missing | Tokens silently excluded |
| AntigravitySessions.swift:90-96 | No blob size cap | skips >1 MiB | differs | Large generation tokens missing silently |
| AntigravitySessions.swift:106-109 | Client "Antigravity CLI" vs "Antigravity" | source only | differs | CLI label gone from rows |
| AntigravitySessions.swift:124-131 | Dedup keeps first, conflict notice | lowest idx only | differs | Rare dropped tokens |
| AntigravitySessions.swift:108-109 | Reader sessions have no navigation target | ingestion.rs:199-203; checkpoints.rs:161-164 | differs | Click tries to open in app; fails for agy CLI |
| AntigravityConversation.swift:9-186 | Prompts and replies from steps | conversation.rs:345-346 refuses SQLite | missing | Session detail: "Message paging is not available" |
| CursorClient.swift:28-42 | Token/email as TEXT or UTF-16LE BLOB | agents/src/cursor/account.rs:76-95 String only | differs | BLOB storage → Cursor quota and sessions fail entirely |
| CursorClient.swift:38,46,53 | One sign-in message | three English messages | differs | Wording |
| QuotaMath.swift:25-27 | Remaining clamped 0…100 | HUD meter label unclamped (model.ts:198-201) | differs | "112%" on HUD |
| CursorClient.swift:110-112 | Window from local midnight, max(168,169) h | UTC midnight − 7 d | differs | Up to the UTC offset of the oldest day never fetched |
| CursorClient.swift:113-120 | Sign-out / account switch clears sessions | kept | differs | Previous account's sessions stay listed |
| CursorClient.swift:132-139 | Dashboard failure notice | unwrap_or_default | missing | Data silently stops updating |
| AdditionalUsageProvider.swift:113-116 | Sessions refresh independently of quota | `?` before sessions | differs | Quota failure also stops session refresh |
| ProviderHTTP.swift:36 | 16 MiB response cap | accounts/http.rs 1 MiB | differs | Heavy users' event pages fail silently |
| CursorClient.swift:203-237 | Title clip 60 with … | trim, 100, no … | fixed | Minor **Fixed 2026-10-20** (session titles). |
| CursorClient.swift:261 | accountWide: true | none | missing | Other devices' Cursor sessions listed like local ones, log path /account/cursor |
| all L10n | zh variants | English only | fixed | English notices/titles **Fixed 2026-10-20** (bilingual text): Antigravity and Cursor notices and the Grok Bot sub-agent title are in both languages. |
| n/a | Windows Antigravity discovery | os/windows | deliberate | New Windows adapter |

Same (21): endpoint/headers, ps gating, flag/port parsing, command runner, account hash, legacy userStatus parse, session roots, db selection, model order and token math, matchedTimestamp, protobuf reader and field numbers, Cursor db path, JWT/cookie, usage-summary fetch and parse, events paging and reconcile, event parsing, automations, Grok Bot spend merge.

Behaviors summarized above, counted for the ledger totals:

| Behaviors | Status |
| --- | --- |
| Matching behaviors listed under "Same" | same ×21 |

## Tests
Mostly portable (JSON/SQLite fixtures, recorded HTTP pairs); `AntigravityCLI.executable` and actor/ledger-bound integration tests are not.

## Architecture
- Short labels and meter clamping in TS instead of Core. Short labels fixed 2026-10-20.
- Antigravity gating by a runtime string compare of a compile-time constant (acceptable).
- Antigravity approval observer runs discovery and loopback HTTP outside the collection gate (Open has an equivalent separate observer).
- Antigravity reader: three passes per change, parses gen_metadata twice, reads all steps, no watermark.
