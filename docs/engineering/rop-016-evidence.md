# ROP-016 — operations-dashboard-v1 evidence

Approved issue #16: revision `2026-10-09T00:28:02Z`, UTF-8 body SHA-256
`d8eb6bc07795e0d6517bc072957965394325ba05c201e54abad9762439c5efc9`.
Implementation base and pre-implementation HEAD:
`2037aeeba0874495bf1f97301f9acf5cc82ee939`, branch
`codex/16-operations-dashboard`. This is an execution record, not approval or
Project status. **Current local gates passed on source42/UI45: backend667,
frontend111, production browser176/176. Independent review and protected remote
checks/merge remain required. Matrix36's173PASS/3FAIL and every prior negative
remain preserved historical evidence, not rewritten as passes.**

## Acceptance matrix

All new integration tests use PostgreSQL 17 and persisted predecessor-module
fixtures, not SQLite. Names below refer to `test_dashboard.py` unless specified.

| Criterion | Evidence and current limitation |
| --- | --- |
| DASH-01: persisted rentals only; pickups, returns, overdue outstanding, financial debt and open incidents; completed debt remains | `test_dash01_real_rental_queues_debt_completed_incidents_and_no_quotations`; completed debt 220.00 includes explicit repair agreement; received maintenance decisions close operational incidents without forgiving debt |
| DASH-01: current financial authority, no receipt-as-payment inference | `test_dash01_financial_summary_matches_payment_authority_after_current_revision` compares remaining/extra/debt/pending/reconciliation with PaymentService after receipt, explicit reconciliation and correction; no new financial writes or rules |
| DASH-01: formal loss only removes decided outstanding; cancelled/review are not confirmed schedule | `test_dash01_formal_outstanding_loss_removes_only_decided_units`; `test_dash01_cancelled_and_review_debt_is_not_confirmed_schedule` |
| DASH-02: São Paulo UTC/day/year boundaries, real/forecast distinction and shared calendar/list selection | `test_dash02_timezone_calendar_forecast_and_outstanding_still_late`; API server default year boundary; leap/non-leap months; forecast moved to November but original overdue remains outstanding; browser forecast/actual receipt labels |
| DASH-03: >100 same day, pages 50/default and max100, filters/order/no omission | 2000 persisted synthetic rentals, 20 pages of100, all unique, repeatable ordering, known times before absent; state/financial/customer UUID filtering; browser125 entries across50+50+25 |
| DASH-03: bounded queries, no photos/documents/N+1 | Volume case asserts11day statements (SET + count/page per5queues), scalar projections only; calendar2/upcoming3 statements by implementation. Measured day0.4109s in focused06; local measurement, not a production SLA |
| DASH-04: session, Origin where applicable, no-store, no PII URLs/logs; 503 not empty | `test_dashboard_api.py`:401/revocation, login403Origin, strict422/private fields/no-store/nosniff,503noqueues; GET at+61seconds leaves last_activity/absolute expiry unchanged. Browser private customer POST search + UUID links. No customer documents/contact/attachments in DTO |
| DASH-05: existing home + keyboard/calendar/list/focus/loading/error/empty/retry/reduced motion/text200% | `DashboardPage.test.tsx`: stale responses/counts, no stale loading/error counts, private links/pagination/focus. UI45 dashboard32PASS; all56 actual dashboard PNGs inspected across320/390/768/1440. Calendar/title320200% intraword wrapping remains a readability limitation, not universal/native UX certification |
| DASH-06: all quality gates and independent review | Local gates PASS: backend32 667PASS/3warnings207.91s, Ruff130/mypy58; exact142 backend/infra source equality to42. Frontend42 111PASS/14files11.86s/lint/format/TS/build/npm0. UI45 original176PASS; Linux/Windows45 locked all-groups audit0. Independent review and protected remote checks/merge remain pending |

## Implementation boundaries

One shared relational projection feeds day, monthly counts and upcoming pages.
Each request uses PostgreSQL `REPEATABLE READ READ ONLY`; its checked_at is
informational and never allocates/promises stock. Existing immutable commercial
versions, current payment applications, actual custody events and manual incident
decisions remain authoritative. No speculative services, AI, roles, realtime,
analytics or automatic fees were added. Migration0012 adds indexes only and
roundtrip preserves persisted rental data. Existing migration-head expectations
were advanced to0012, not weakened.

Lists are bounded50(default)/100(max), with stable date/time NULLS LAST/creation/
rental UUID ordering. Day debt/incident queues are current pending records, not
historical as-of accounting; selected date controls daily schedule and overdue
cutoff, as described in the UI. All authenticated users retain equal permissions.

## Preserved negative results and diagnosis

Private evidence root: `/home/rop004-rehearsal/rop016-zpvjkwF0/evidence`.
Immutable source-run01–09 directories and SHA256 manifests preserve source
revisions before reruns. Original results are never overwritten.

- focused01:2collection errors (nullable strict boolean), corrected contract.
- focused02:15PASS/1FAIL (test attempted prohibited in-place rental UPDATE), fixed
  fixture to perform actual handover; focused03:18PASS/3warnings30.73s.
- Windows Vitest initial96PASS/1FAIL ambiguous option/badge selector; later
  97PASS/1FAIL accessible count label; fixed scoped selection/explicit aria-label.
- frontend05:93PASS/5FAIL5000ms timeouts. Focused unchanged-source diagnostic
  five files46PASS5.08s; this is not a replacement full gate or proof of cause.
- backend05:653PASS/2FAIL/3warnings267.61s, concurrent issuance and return versus
  confirmation statement timeouts. Focused unchanged-source diagnostic2PASS3.16s.
- backend08:656PASS/2FAIL/3warnings214.13s: `test_origin_limit_and_concurrent_failures_cannot_bypass`
  and quotation `test_sequential_and_concurrent_replay_single_audit_and_changed_payload_conflict[revise]`.
  Both fail waiting on advisory transaction locks with existing3000ms timeout.
  New dashboard cases21/21 pass in that same full run. **Full run remains FAIL.**
- advisory-diagnostic08:2PASS/2warnings8.49s; sampled pg_stat_activity state,
  wait_event, timing and blocking PIDs only, never query text/parameters. Auth
  call5.10s across original12concurrent attempts; observed waiter~1.06s. Quotation
  call0.14s. No safe cause/fix for prior full-run failures has been demonstrated.
  No unchanged full rerun, timeout increase, worker reduction or retry was used.
- Windows Vitest97PASS/1FAIL focus assertion exposed an immediately-resolved
  response batching loading true/false; settlement signal fixes production focus.
  Source09 full frontend98PASS includes that assertion unchanged.

The machine/WSL shutdown later left the own database stopped; it was cold-copied
before restarting the same cluster. PostgreSQL recovered its WAL normally. This
later event is **not evidence of the cause** of earlier test failures. Previous
fixtures/MinIO were not restarted or modified.

## Browser test organization and visual limits

browser06 preserved original combined125/day→calendar→filter→upcoming→rental
journey; it timed out30s during the fourth full-page axe scan (3other cases passed).
Source07 split visual checks by user task, preserving all assertions/full-DOM axe
scans: day/counts+row (16.9s), calendar+upcoming (16.6s), completed debt(6.2s),
forecast(5.7s), empty/loading/error/retry(4.6s), separate calendar text200%(7.5s).
All6automated cases passed390, but image inspection found overlapping200%calendar
digits. That was a real UX failure despite the automated pass. Source08 fixes
minimum cell width, local keyboard-scrollable region and paginated alternative;
new checks assert each calendar button's content does not horizontally overflow.

To avoid disguising the original journey's time budget, source09 additionally
keeps the **complete combined user journey** under the unchanged30s test limit,
including all125unique links/pages, calendar arrow/Enter focus, private search,
filters, upcoming count, return to day and direct rental navigation. Every
original full-DOM axe scan remains in the focused visual cases, with original
timeouts, two workers and zero retries. These are additional checks, not a claim
that the failed source06 became an unchanged pass.

| Original source06 combined assertion/check | Source09 coverage |
| --- | --- |
| 125 day count, pages50/50/25,125unique links, page focus, previous/next/disabled | Day case and additional combined journey |
| Day counts and first row full-DOM axe/no page overflow | Day case: `day-counts`, `day-row` |
| Month counts125, next/previous heading focus, arrow keys/Enter to day/H1 | Calendar case; arrow/Enter and same counts also in combined journey |
| Calendar full-DOM axe/no page overflow | Calendar case: `calendar` |
| Body-only customer POST, no name in URL, selected UUID, financial filter | Day case and additional combined journey |
| Upcoming same-day125 count, return to day, actual rental UUID/quotation link | Calendar case and additional combined journey |
| Upcoming full-DOM axe/no page overflow | Calendar case: `upcoming-row` |

The original30s timeout included four full-DOM axe scans. Source09's combined
journey retains the uninterrupted business navigation under that same30s limit;
the four scans are still performed in the day/calendar cases, not omitted or
scoped to a subtree. This changes test organization, not the failed06 result.
Additional calendar200%/cell-overflow regression has its own unchanged30s limit.

The prior task's native computer-use policy stop was respected: no alternate
native mechanism attempted. Production Chromium/Playwright viewport testing,
keyboard and CSS text enlargement are synthetic checks; not physical devices,
native browser zoom, a screen reader, all orientations or certification of full
accessibility/usability. Visual inspection must use actual captured pixels,
including200%text; axe alone is insufficient. No real customer data is used.

## Historical validation state — source09 (FAIL preserved)

Source09 Linux: locked install; ESLint/Prettier PASS; Vitest98PASS/12files13.37s,
unchanged default concurrency/5000ms limits; production build138modules; npm
audit0. Locked all-groups pip-audit Linux09 and Windows08: no known vulnerabilities.
Warnings are upstream Starlette/httpx/anyio deprecations plus pytest record_property
with xunit2. No warning was suppressed.

Production matrix09 finished exit1: **165PASS/7FAIL of172**,2workers,0retry and
existing timeouts unchanged. This is a **FAIL handoff, not completed delivery**.

| Viewport | Final result | Dashboard combined journey |
| --- | --- | --- |
| 320×740 | 40PASS/3FAIL,3.0m | 5.7s PASS within30s |
| 390×844 | 43PASS,2.6m | 5.7s PASS within30s |
| 768×1024 | 41PASS/2FAIL,2.9m | 6.3s PASS within30s |
| 1440×1000 | 41PASS/2FAIL,3.0m | 5.6s PASS within30s |

Dashboard cases:24PASS/4FAIL of28. Four failures are page horizontal overflow:
calendar200% at320; completed-debt200% at320/768/1440. Other regressions: CPF
customer search at320 returns total2 instead of expected1 (not a timeout);
rental-change full journey at768/1440 exceeds original30s near final linked
customer navigation/revision4 assertion. No safe cause/fix was demonstrated for
those timing/search failures; they were not suppressed, split or retried.

44named dashboard PNGs were produced and actually inspected, plus the4dashboard
failure PNGs. Missing named captures:320calendar200%,320/768/1440debt200%, because
the overflow assertion precedes capture. Actual failure screenshots are retained,
not replaced by another width. Normal rows, calendar/forecast, loading/empty/error,
counts, links and keyboard focus were inspected at each width. These observations
do not approve the outstanding defects. Full logs, per-project HTML reports,
error contexts and retained predecessor traces remain private in source-run09.

Gitleaks8.30.1 history09:69commits/~5.20MB,0leaks. Private temporary-index staged
scan09 (real index unchanged):~117373bytes,0leaks; includes new files. Final
docs-only snapshot/scan and exact artifact fingerprints are in the private
handoff. Source08 and09 backend trees are identical excluding generated caches;
the negative full backend run remains applicable, not replaced by diagnosis.

Final resource cleanup at2026-10-13T00:09:14Z: created `final09.dump` and SHA256,
then stopped only PG PID449 in the exact own fixture/data. Ports15448/8000/4173
were absent after teardown. Fixture directories/sources/backups retained; MinIO
fullID/StartedAt/healthy unchanged. No commit, publication, PR, independent review,
merge, Project Done or execution-owner release was performed. Head/base remains
`2037aeeba0874495bf1f97301f9acf5cc82ee939`; implementation is uncommitted/resumable.

### Observed source09 visual failures

320: page horizontal-overflow assertion fails in calendar200% and completed-debt
200%. The named200% captures are therefore absent (assertion precedes capture);
original `test-failed-1.png` screenshots remain. Calendar digits are now readable
within local scrolling, but that does not excuse page overflow. At768, completed
debt200% likewise fails page overflow, as does1440. Their failure screenshots show
queue numbers extending outside narrow cards. These are outstanding UI defects.

390 passed automated checks, but actual inspection of `mobile-390-dashboard-day-counts.png`
shows the financial-pending125 count pressed/clipped at the card's right edge.
Automated PASS does not approve that visual defect. Normal-size day/debt rows,
loading/empty/error states and forecast labels were inspected at320/390/768;
calendar200% captures at390/768 show readable digits and visible keyboard focus
with local horizontal scroll/list alternative. They do not substitute for the
missing320200% named captures or certify the whole page. Native date input display
also follows browser locale; Brazilian display in that native control has not
been certified independently of the explicit DD/MM/YYYY row/calendar labels.

## Human-authorized corrective investigation — sources11–16

The human explicitly authorized continuing this same owner/executor after the
source09 FAIL handoff. Original sources, logs/XML, traces, screenshots and the
831-artifact manifest remain immutable. No timeouts, assertions, workers or
retries were relaxed; the original uninterrupted journey and full-DOM axe scans
remain mandatory.

- Customer search trace09 proves the generic response waiter captured an earlier
  refresh/phone response (total2), while the actual CPF POST returned total1.
  The waiter now matches POST plus its exact submitted search field; original
  expected totals remain2/1. No request values appear in diagnostic summaries.
- Queue geometry regression11 failed at390 normal and320 text200%. Cards now
  wrap labels/counts and use rem-aware minimum widths. Source12 passed3/4; the
  remaining320 page overflow was not accepted. Geometry14 measured the timezone
  paragraph304.5px inside288px; source15 measured calendar/debt heading right
  edges328.45/324.86px in320. Headings allow wrapping without hiding content.
- Real PostgreSQL probe13 failed because password verification held identifier,
  origin and account locks. Login now checks exhausted budgets before Argon2,
  releases the transaction, verifies outside locks, then atomically rechecks
  counters, current hash and active account before creating a session. This
  preserves the existing failure-count semantics (not a new attempt-admission
  mechanism). Concurrent preflight work may exist, but no completed failures
  bypass the atomic limits; changed hash/active state rejects the stale result.
  Fresh login after reset remains possible. Focused auth14:42PASS,2warnings,
  29.56s, including12concurrent failures, reset/deactivate during verification,
  exhausted-budget no-verify, session/revocation and lock-free probe. This does
  not establish the cause of every08 timeout or of quotation replay.
- Diagnostic15 ran32 isolated browser contexts across4projects in one harness,
  unlike the normal per-width matrix. Pools intentionally remained alive until
  global teardown and reached100 connections:5desktop setup500 failures.
  Dashboard tests now release only their exact cookie-selected synthetic
  context after each test; global teardown remains an idempotent fallback.
  PostgreSQL regression checks pool/schema disposal and untrusted-origin guard.
  No production endpoint, database limit or worker configuration was changed.

UI15 remains24PASS/8FAIL:2geometric320200%,1setup CREATE TABLE timeout with
undemonstrated cause,5connection-exhaustion setup failures. Backend15 passed
Ruff/129format but stopped at mypy's Argon2 Literal[True] inference; explicit
`valid: bool` fixes that annotation without changing behavior. Pytest did not run.
Legacy rental-change screenshots are1440×10674 and took roughly1–1.5s each in
the failed09 trace; this is observed cost, not a proven exclusive30s cause.
Final corrected full backend/frontend/per-width production gates are pending.

## Corrective validation17 and environment diagnosis20–21

Source17 lifecycle regression:2PASS/2warnings/7.32s, including three exact
cookie-selected schema/pool disposal cycles, Origin rejection and global
fallback/parallel isolation. Full backend17:662PASS/1FAIL/3warnings/210.91s
(663 tests, no skips); Ruff129format/mypy58 passed. The remaining concurrent
origin failure is PostgreSQL advisory-lock statement timeout. Quotation replay
passed, which does not establish its earlier timeout's cause. Private profiling
recorded one error in47.728ms, but lacked PID/clock correlation; its file-writing
overhead was not quantified, so it is not an uninstrumented final gate.

Frontend17:98PASS/12files/13.89s; lint/format/build138modules/npm audit0.
Normal production matrix17 retained2workers,0retries,30s and fresh harness per
width:32040PASS/4FAIL4.2m;39043PASS/1FAIL2.7m;76838PASS/6FAIL3.6m;
144043PASS/1FAIL3.2m. Total164PASS/12FAIL of176. All32dashboard cases passed,
including the original uninterrupted day-to-agenda journey (5.1–6.3s) and
full-DOM axe. That is not full-matrix approval. Remaining failures:3auth timing,
3rental-change,2reservation,2custody and2contract cases. Most legacy failures
hit the unchanged30s bound; contract768 also has a pending logo-removal5s
assertion. Their causes are not all established.

The auth timing trace proves a mocked session200 followed by an unmocked real
operations/day401 before the logout button assertion. That suite now mocks the
home read with an empty day DTO and asserts its200 response, retaining1h idle,
zero activity renewals, logout/revocation and real auth/dashboard suites.
No production authorization error is hidden by this test-only isolation.

A read-only4500-sample probe demonstrated current guest wall-clock jumps while
monotonic time advanced normally. Probe20 then correlated PID54727/query655:
`pg_sleep(.1)`, statement timeout3s, SQLSTATE57014 after1580.466ms monotonic,
4299.710ms wall, spanning a2719.230ms guest wall jump. Host wall-minus-monotonic
change was−.0005ms; the own PostgreSQL log confirms the same PID/error. The
5557 raw records include4653clock samples/902queries/one cancellation. This is
direct evidence of an environment timing failure, not exclusive attribution
of every earlier test failure. PostgreSQL17 uses wall timestamps for timeout
deadlines/expiration checks ([timeout source](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/misc/timeout.c),
[timestamp source](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/timestamp.c)).

The [Canonical WSL time-sync documentation](https://ubuntu.com/wsl/docs/stable/explanation/time-sync/)
describes the Ubuntu24.04 NTP/Hyper-V implicit synchronization conflict. The
installed WSL2.7.10/kernel6.18.33.2-2 has implicit host synchronization enabled;
timesyncd255.4 polled a differing NTP source every32s. After matrix completion,
private backups, process/service inventory and preserved unit/config/runtime
prestate, only that service was temporarily stopped under existing human local
environment authorization. No manual/fake clock, persistent disable, kernel
change, WSL/Docker restart or MinIO restart was made. Host synchronization is
the real clock authority; this affects guest time globally, not just the tests.
The unit remains enabled and rollback is starting the same service. MinIO's
full identity/start/healthy/restart0 readback stayed unchanged. The identical
95s post-change query/host/guest clock probe and final full gates are pending;
no current delivery approval is claimed.

The first post-stop21 probe recorded a one-time−73.702s host convergence and a
73.863s query stall; it was not accepted as stable performance. A single settled
95.060s probe22 then recorded934queries/4679clock samples with no cancellations
or wall-minus-monotonic jumps above100ms, maximum query103.895ms and guest/host
offset below2ms at both ends. Raw transition and stable samples are retained.
The service remains temporarily inactive/enabled with unchanged configuration;
it must not be automatically restarted during the gates and recreate conflicting
clock writers. Rollback/temporary environment duration is explicit in the private
handoff, not a persistent environment change made by this delivery.

Uninstrumented full backend22 passed663tests/3warnings in210.51s (XML0failures,
0errors,0skips), Ruff129format/mypy58. Frontend22 passed98tests/12files9.41s,
lint/format/build138modules/npm audit0; Linux and Windows locked all-group
pip-audit found0known vulnerabilities. Production matrix22 passed175/176:
32044PASS2.8m;39043PASS/1FAIL2.9m;76844PASS3.0m;144044PASS3.1m.
All32dashboard cases passed, but the original390rental-change journey exceeded
30s (32.2s). Its trace showed preview/confirmation delays, not just screenshot
cost. Neither stable clocks nor another width's pass erases that failure.

Private diagnostic24 (five cases,47.7s) and25 (all44cases390,2.9m) passed with
two workers and unchanged30s limits, but did not reproduce the original delay.
They are instrumented diagnosis, not a replacement full gate or a proven fix.
Diagnostic25 measured2.006s aggregate write instrumentation cost over4842calls,
not total profiling overhead or user latency. Its one23505 error maps to the
expected synthetic customer duplicate409, not a statement timeout.

## Measured local version-history read optimization — sources26–28

The profile measured repeated current rental reads for every historical version.
The new real PostgreSQL regression27 preserves four independent `get(version)`
results and initially failed4/4 because current-rental helpers ran four times.
SQL counts were26(no rental),38(confirmed),78(out),78(completed). A source26
fixture validation error and lint error are separately preserved, not counted as
proof of the production issue.

Only one `versions()` call now reuses its current rental summary, physical
outstanding and current money through the same existing helpers/PaymentService.
There is no global or cross-request cache, new persisted state, new financial
authority, business write or DTO change. Each version still computes capacity
using its own dates; each returned rental summary is a separate copy. This small
internal read context avoids repeating known work, without a new interface or
framework.

Regression28:4PASS8.05s, counts23/26/37/37. Confirmed bound30 was chosen from the
measured38 minus12 duplicated reads before implementation, not relaxed after a
failure. Assertions retain equality with every individual version, one current
helper read, no row aliasing, another quotation's isolation, and fresh next-call
results after real revision/cancellation/partial return/receipt correction.
Ruff130format/mypy58 passed. This demonstrates reduced duplicate work, not the
exclusive cause of the earlier390 timeout. New full source28 backend/frontend/
production-four-width gates, final visual inspection and secret scan are pending.

## Source28 full result, standby and diagnostic29 limits

Full backend28 was uninstrumented:667PASS/3warnings207.48s; XML667 with zero
failures/errors/skips, Ruff130 formatted files and mypy58 files passed.
Frontend28:98PASS/12files9.90s, lint/format/build and Linux/Windows locked
all-groups dependency audits passed with zero vulnerabilities.

Matrix28 exited1:171PASS/5FAIL of176,2workers/0retry/original30s. Widths:
32040P4F3.5m;39043P1F3.5m;76844P2.9m;144044P3.2m. Failures:320 historical
contract download received48bytes JSON matching the existing session-denied
detail, custody focus assertion found login/session-ended, custody axe reached
30s, dashboard queue screenshot stability reached30s;390 rental-change journey
reached30s at its existing viewport screenshot. No assertion, screenshot or
timeout was removed. Dashboard31P1F and55/56namedPNGs;320queue200% is absent,
not substituted. Four320 traces are absent even in the HTML report;390 retained
its trace. Original outputs and a pre-diagnostic backup remain private.

Windows Kernel-Power506 recorded Modern Standby idle entry06:29:29UTC and507
power-button resume08:15:56UTC. This106-minute suspension and a6425.328s PG
checkpoint wall duration are demonstrated events. Authentication retains its
real1h idle limit. Session-denied JSON does not prove a PDF rendering defect;
missing HTTP status/trace/per-case wall timestamps limit attribution. The later
390 failure is not attributed exclusively to standby.

One authorized private diagnostic29 retained44cases at390,2workers/0retry/30s,
adding safe request/PID/query-count/wait/IO/clock instrumentation.44PASS3.0m,
rental29.4s: not a fix/full gate. A separate temporary Windows thread requested
only `ES_CONTINUOUS | ES_SYSTEM_REQUIRED` on AC, with900s ceiling/1s DC/unknown
monitoring. Its own stop signal was created immediately at diagnosticFINAL;
same-thread clear succeeded after208.1155804s and the process exited. No display/
away mode, persistent power setting, manual clock change or restart was used.
Read-only `/requests` inventory required administrator access and was not
escalated: policy effectiveness is not certified. Manual/lid/policy behavior is
not claimed. [Microsoft execution-state API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate).

Diagnostic29:4617records/1289HTTP/171monitors over170.914257554s; zero wall-minus-
monotonic jumps above100ms (max4.227805ms).15product creates max84.985394ms/
10SQL13.935349ms;4.272s28 was not reproduced. Sampled waits7WalSync/3WALWrite;
`track_io_timing=off` meanszero timing fields cannot prove no IO cost. Maximum
36connections; one expected synthetic duplicate23505. Recorded output-write
overhead1.669905908s aggregate is not total instrumentation/user latency.

## Hidden list request lifecycle: RED30 to GREEN31

Code/profile29 showed `/quotations/search` running while private UUID detail/
editor was visible; one search made230SQL/1035.718706ms. The minimal correction
limits the list effect to list mode without a selected identifier. Mode/identifier
dependencies abort hidden pending reads and fetch current list on return; no
cache, DTO, business write or guard changed. This removes demonstrated unnecessary
work, not a proven exclusive cause of the earlier390 timeout.

Four focused regressions failed before correction (RED30,3.41s) and passed
unchanged afterward (GREEN31,2.52s): no hidden search for direct UUID/detail/edit/
saved revision; fresh list return retaining filters/page; abort/ignore stale
pending list response; identifier navigation aborting stale reads while keeping
existing detail until next response. These page-lifecycle tests stub child
editor/detail only; their existing tests and original production journeys remain
required. Source32 full backend/frontend/four-width browser, image inspection and
secret scans are pending.

### History navigation regression and final source35

Source32 full backend passed667 tests/3warnings207.91s, Ruff130/mypy58;
frontend102PASS/13files8.38s/lint/format/build/npm0. The backend guard's clear
succeeded after259.161836s (includes setup/polling), same thread, process exited.

A required history-Back regression exposed detail mode remaining visible after
the UUID disappeared: RED33 fourPASS/oneFAIL3.49s. The minimal identifier effect
now returns a loaded detail to list mode only when the identifier is absent;
an AbortController cancels a queued reset after newer navigation. New/edit
drafts are not reset, and identifierA→B keeps existing detail until response.
GREEN34 fivePASS2.55s retains previous assertions and adds Forward fresh-read
and new-editor-without-UUID preservation checks. Backend code is unchanged;
source35 will fingerprint that equality and validate the final frontend/matrix.

Source35 full frontend:103PASS/13files11.23s, lint/format passed, but buildFAILED
TS2769 because the new RTL role query used Playwright's `exact` option. Source36
mechanically uses an anchored name regex instead: the same exact-match assertion,
not weakened. Source35 negative log/source remain preserved; final frontend/
production validation must use source36. Backend remains unchanged from32.

## Final validation36: FAIL, preserved for recovery

The final production matrix exited1:173PASS/3FAIL of176;32044PASS2.8m,
39044PASS2.7m,76843PASS1FAIL3.0m,144042PASS2FAIL3.3m. Original2workers,
zero retries,30s test budget, all original assertions/axe/captures remained.
Dashboard-specific cases32PASS, including the uninterrupted day→agenda→filter→
rental journey. This does not override failures in the complete matrix.

| Failed original case | Observed evidence; attribution limit |
| --- | --- |
| 768 rental-change/resumption journey | Reached final viewport screenshot at line351; several changes POSTs took1.90–2.02s. Unknown-outcome502/aborted request were original intentional simulations. No failing-run SQL/PID/CPU correlation to assign an exclusive cause |
| 1440 rental-change/resumption journey |30s reached at the review-state assertion; one fullpage capture took3437.913ms and cancellation POST2011366.895ms. Distributed costs do not prove a single screenshot or backend defect |
| 1440 capacity/financial-conflict journey |30s reached at final viewport capture line426; receipt POST2003292.585ms, payments GET2457.778ms, signature-state GET2108.537ms, operations GET2009.973ms. No demonstrated additional safe minimal correction from the current trace |

The measured read-context/hidden-list/history fixes retain their RED→GREEN
regressions, but did not prove resolution of every30s full-suite failure.
No unchanged-until-green rerun, budget split, worker/retry/timeout relaxation,
capture removal, broad speculative performance rewrite or approval follows.
Whole final matrix log SHA256:
`be5b700e923928d5b2131536c84e8a9820fcce632eefc0c372f6985c8007df15`.

All56 final dashboard PNGs (14perwidth) were individually inspected, not edited
or substituted. Normal/200% counters125 are intact; debt220 remains distinct
from completed operational status; planned/actual/forecast labels, loading,
error/retry and empty states remain visible. Calendar keyboard focus31 is visible;
narrow grids use their documented local horizontal scroll/list alternative.
320200% title wraps within Calendário: a readability limitation. These are CSS
text200% Chromium captures, not native zoom, physical-device or screen-reader
certification. The earlier native-tool policy stop was not retried or bypassed.

Backend32 full results apply to final36's exact119backend+23infra source files;
their normalized aggregate SHA256 is
`36f5d5d6d53270b1a08e87494311bf147fa1f7338851f66951294df3e059df0f`.
Generated caches were excluded from comparison, not deleted or concealed.
Frontend36 build138modules353ms, asset `index-BDWymzuk.js`;103PASS13files8.68s,
ESLint/Prettier/build/npm and Linux/Windows locked all-groups audit passed.
Source35's preceding test-typing build failure and all other negative outputs
remain preserved.

The finite matrix guard automatically cleared in its wrapper's finally before
agent analysis:730.3926412s, same thread, clear success, process exited. No power
policy setting was changed, no renewal occurred, and `/requests` access was not
elevated. All own browser/harness processes ended; own PostgreSQL15448 was stopped
only after dump/artifact/cold-data preservation. No data/evidence/older fixture
was deleted and MinIO's identity/start time/healthy/restart0 were unchanged.

ROOT authorized restoring the original timesyncd active/enabled state only after
own jobs stopped and a fresh inventory/config check. The next inventory already
showed active/enabled PID173 before the explicit idempotent `systemctl start`;
PID changes suggest a runtime lifecycle event, but its cause is not demonstrated.
All three original configuration hashes match, and the final readback is active/
enabled. No manual clock, persistent disable, WSL shutdown/restart or Docker/MinIO
restart was issued. No post-restoration test/clock stability gate is claimed.

Final documentation-only snapshot/fingerprints, secret-scan results, exact dirty
HEAD/base and private recovery paths are in the coordinator handoff. No semantic
delivery commit/PR, independent review, protected checks or merge is claimed.

## Current source42/UI45 full local validation

After the human authorized continuing the SAME owner/executor, the static36
trace showed three independent conflict-comparison GETs serialized in
`QuotationEditor.loadConflict`: quotation1792.076ms, payments2457.778ms,
rental1530.149ms. Their summed5780.003ms cost is not the exclusive cause of all
three historical failures. The smallest local Promise.all starts the three
reads together and publishes comparison state only after all succeed; no cache,
DTO, write, business guard, retry or timeout changed. RED38 retained one expected
serial failure plus four new-fixture missing-input failures; corrected fixture
RED39 was7PASS/1FAIL8.53s. The unchanged regression assertions GREEN40 were
8PASS7.52s: all starts before resolution, divergent versions9/17/23, adverse
completion order/no partial state, each failed read, no-rental/nonrevision,
fresh next409, preserved draft/reason/request key and unknown-outcome retry.
These controlled mocks do not certify real PostgreSQL write revalidation.

Full frontend41 retained111PASS followed by a new-fixture TS2352 build failure.
A complete typed Payments fixture fixes only that mechanical error. Source42
full frontend:111PASS/14files11.86s, ESLint/Prettier/TypeScript/build138modules
416ms/npm0; JS `index-CE62wUak.js`, CSS `index-C9CUtQZq.css`.
Backend32 and source42 have exactly142 backend/infra files equal, excluding only
generated virtualenv/caches (not deleting them). All-file aggregate SHA256
`46d018698e0f0f2fa7c2252bc6a957419e2b656be1e88372f59883bed4fdb98a`.
Thus the uninstrumented667PASS/3warnings207.91s/Ruff130/mypy58 gate remains
applicable without a redundant backend rerun. Both platforms' locked all-groups
pip-audit45 and npm audit45 report zero known vulnerabilities.

Diagnostic43 was aborted before browser start on a guest wall-minus-monotonic
jump1092.853443ms. Guard cleared, ownPG stopped and original service remained
active/enabled/config unchanged. No diagnostic PASS or exclusive service
causation was inferred. One clock-only44 collection95.0298822s retained its
initial backward jump−73620.232710ms and76.224153682s later observations; it
was NOT treated as95seconds steady. It restored the original service after
its sampler was reaped. All raw transition/RTT/offset bounds remain private.

ROOT then authorized ONE finite UI45 operation with private reviewed helpers:
original service TEMPstop, fixed40s transition (all samples retained), fixed95s
validation (920 read-only100ms PG queries, wall/mono/RAW/BOOTTIME/hostRTT), then
the original source42 production matrix only if valid. No window reset/retry,
manual clock, persistent configuration, WSL/Docker/MinIO restart, SQL profiler,
request hook/header or production instrumentation was used. During UI only an
external1Hz OS clock observer ran; no concurrent SQL probe or other suite.

| UI45 original production matrix | Result |
| --- | --- |
| 320×740 |44PASS2.7m |
| 390×844 |44PASS2.5m |
| 768×1024 |44PASS2.8m |
| 1440×1000 |44PASS2.9m |

Wrapper exit0/child0,176PASS/0FAIL. All original2workers/0retry/30s tests,
assertions, full-DOM axe and captures remain. Original rental-change journey
durations25.0/22.1/26.3/28.2s and capacity/conflict10.3/10.7/11.1/12.5s; these
are observations, not a production SLA or exclusive attribution/performance
claim. Successful tests retain failure-only traces; no extra successful trace
was introduced to claim real-network Promise.all overlap.
Whole matrix log SHA256:
`a7e2943962a101fbf6bdba70e60b94815922ce5819bab00312661cb198e44307`.

All56 dashboard PNGs were individually inspected by the SAME executor. All96
current rental-change PNGs were inspected jointly: executor48(mobile320 and
desktop1440), ROOT48(mobile390 and tablet768). The source has11 visual names
each full+viewport, plus change-diff/cancelled-commercial-summary:24perwidth,
not the earlier estimated88 total. No original image was edited or substituted.
No new blocking overlap/count truncation was observed in dashboard100/200%
captures. Local calendar scrolling and its alternative list are explicit;
planned/real/forecast, operational completion and debt remain distinct.

Limits:320200% Calendário wraps intraword; very tall legacy full-page images
prove overall layout only, not every small text. Some legacy viewport images
do not frame their entire named state. Native date controls follow browser
MM/DD/YYYY locale and long native select values can truncate visually; the
dashboard's explicit date labels are DD/MM/YYYY. An inherited preview sentence
still says contracts apply "when available", though contracts already exist;
this wording does not change signature/stock guards and was not changed without
revalidation. Chromium/CSS200%, synthetic fixtures/keyboard/axe are not native
zoom, physical-device, screen-reader or universal usability certification. The
earlier native-tool policy stop was never retried or bypassed.

Guard45 used only ES_CONTINUOUS|ES_SYSTEM_REQUIRED, AC-only,900s hard/no renewal.
STOP was issued at UI FINAL before teardown. Actual same-thread API clear
succeeded802.4346081s after activation, about0.872s after FINAL; scoped cleanup
had already started during its1s monitor cadence. Do not claim actual API clear
preceded the first cleanup action. It preceded ownPGstop/service restoration.
Guard/wrapper processes exited; scoped children remaining[], ownPG15448 stopped
after its final dump, sampler joined, then service restored active/enabled with
all3 original config hashes. MinIO identity/StartedAt/healthy/restart0 unchanged;
old fixtures and all evidence/data retained. No post-restore stability or durable
environment fix is claimed. Independent exact-SHA review/protected remote gates
and develop merge remain mandatory, not inferred from these local results.
