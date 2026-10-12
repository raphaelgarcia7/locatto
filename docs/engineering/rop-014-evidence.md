# ROP-014 — handover-return-v2 evidence

Approved issue #14 revision: `2026-10-11T19:10:48Z`, UTF-8 body SHA-256
`c6c18e56dc9abb0ba4ffd54e58eed040094adbb3097b88a2d237f06616730225`.
The human-approved v2 adds explicit maintenance routing before operational close;
it does not waive any v1/historical criterion. Implementation base:
`e5a779b053b6594af0178fb00c328c0d40a3566e` (develop). Product rules and private API
contracts are documented in [handover-return-v2](../product/handover-return-v2.md).

## Acceptance matrix

All integration cases below use migrated PostgreSQL 17, not SQLite or mocked
business services. Test names are in `backend/tests/integration/test_handovers.py`
unless another file is named. Existing #8/#10/#11/#12/#13/#15 suites run together.

| Approved criteria, including historical requirements | Executable evidence |
| --- | --- |
| RET-01: full effective products/quantities/condition; valid deposit, zero balance or attributed exception; third-party name/authorization, no CPF requirement | `test_ret01_signature_balance_versions_integral_third_party_and_replay`; strict contract unit tests; real browser unsigned gate, third-party exception and full checklist |
| RET-01: absent/unsigned/old signature cannot bypass; concurrent contract/payment changes read transactionally | `test_ret01_missing_contract_and_earlier_signature_never_bypass_financial_exception`; `test_ret01_contract_finance_race_reads_locked_versions_no_signature_bypass` with real concurrent issuance/correction and locked-version outcomes |
| RET-02 / R08-RET / R11-RET: exactly 10 sent, 8 fit on 13/10, only 8 free on 14/10, two missing remain blocked; received damaged/cleaning unavailable; no double allocation deduction | `test_r08_ret_ten_sent_eight_fit_two_missing_then_cleaning_not_double_counted`; `test_ret02_partial_fit_outstanding_capacity_next_day_and_validation` |
| RET-02: partial/full replay, positive quantity, sent product only, cumulative cap, invalid dates | Same RET-02 tests, API authenticated replay, strict contract tests, real browser commit-with-lost-ACK then exact-body/key replay |
| RET-03: early/real calendar date +1 São Paulo, weekends/holiday/month/year and UTC boundary; maintenance release cannot free earlier | `test_ret03_real_calendar_next_day_early_weekend_holiday_month_year_and_timezone`; R08 exact-quantity case and v2 release tests |
| RET-03 v2: close with debt only after explicit maintenance routing of received quantities; close does not release/repair/lose/charge/forgive; missing/unaccounted blocks; later explicit release after completed | `test_ret03_v2_close_requires_maintenance_decision_debt_persists_release_after_close`; `test_ret06_unknown_commit_ack_replay_and_v2_maintenance_close_rollback`; API full maintenance/close/repair flow; real browser completed + debt + stock still in maintenance then release |
| RET-04 / R11-LATE: overdue with/without new forecast blocked until real receipt, confirmed conflicts visible and never auto-cancelled | `test_ret04_late_forecast_never_releases_stock_until_real_return`; `test_r11_late_conflict_visible_without_cancel_and_stock_adjustment_race`; existing quotation/reservation suites |
| RET-04 / R11-RET: fresh quotation/new confirmation and last-unit races with return/stock adjustment | `test_r11_ret_concurrent_last_unit_return_and_new_confirmation`; R11-LATE stock-adjustment race; R08 quantity query/confirmation regression |
| RET-05: explicit formal loss, physical withdrawal + outstanding atomic, no fake receipt/release/double loss; no automatic fee; distinct repair/replacement quantities and manual linked agreement | `test_ret05_loss_atomic_no_fake_return_financial_manual_and_no_duplicate_damage`; `test_ret05_loss_rollback_damage_repair_replacement_guard_and_migration_preservation`; signed v0.4 agreement validation and API manual obligation without receipt/refund |
| RET-06: same-key replay/canonical mismatch, stale versions, two actual attendants, precommit rollback, immutable snapshots, migration preservation | `test_ret06_two_attendants_same_key_rollback_and_stale_version`; `test_ret06_distinct_attendants_cannot_double_return_or_maintenance_decision`; lost-ACK/maintenance-close rollback test; migration downgrade refuses custody data |
| RET-06 / #13 out/completed: no post-handover cancellation, extension with fresh physical demand, new rental from completed without payments | `test_r11_ret_actual_out_cancel_extension_partial_and_completed_copy`; old commercial snapshot contents and immutable history asserted |
| RET-07: session attribution, private history, typed errors, Origin/CSRF, no actor authority or extra PII fields | `backend/tests/integration/test_handover_api.py`: 401/403/404/422, private no-store, third party, typed operations/returns/resolutions/agreements/close, history and captured-log PII checks; unit strict bool/money/int limits |
| RET-07: no hidden product cap, explicit unknown/error/loading/empty/success states, keyboard/focus, four widths, reduced motion, 200% text | `CustodySection.test.tsx`: 125 lines, unavailable read is not empty, unknown freezes exact request; `frontend/e2e/custody-live.spec.ts`: real session/API/PG + axe/masked captures, full operation and customer debt; manual browser inspection below |

## Local validation

Own PostgreSQL fixture: `/home/rop004-rehearsal/rop014-O4dwyoUU`, private loopback
15447, isolated schemas per suite. Previous fixtures and user MinIO are not used as
disposable resources. Source snapshots `source-run01` through `source-run13` and
exclusive logs under `evidence/` are retained; original failed attempts are not
overwritten. Final candidate `source-run13` results:

| Command | Result |
| --- | --- |
| `uv run --project backend ruff check backend infra` | PASS |
| `uv run --project backend ruff format --check backend infra` | PASS, 120 files |
| `uv run --project backend mypy --config-file backend/pyproject.toml` | PASS, 55 source files |
| `uv run --project backend pytest -c backend/pyproject.toml backend/tests infra/tests -q` | 626 passed, 2 upstream deprecation warnings, 251.11s; `evidence/pytest13.log` |
| Locked all-groups dependency export + strict `pip-audit --no-deps --disable-pip` | No known vulnerabilities, Linux and Windows resolution |
| Frontend ESLint / Prettier / Vitest / production build / npm audit | PASS / PASS / 87 passed / PASS (134 modules) / 0 vulnerabilities |
| Gitleaks 8.30.1 full Git history (`--all --redact`) | No leaks, 64 base commits; final commit/diff scan recorded in delivery journal |

Production browser matrices `rop014-matrix01/02` run against the Vite production
build and a real private backend/PostgreSQL, all 35 specs at each width. Matrix01
completed 320/390 (35 passed each). A session interruption left tablet incomplete;
its original output remains retained, and only tablet/desktop resumed in matrix02.
Evidence is private under `frontend/test-results/rop014-matrix01/02/evidence`,
per-project output and `frontend/playwright-report/rop014-matrix01/02`. Existing
ignored outputs were backed up before both runs; traces are off for custody tests
and screenshot inputs/contact are masked. Final completion counts and exact
source fingerprints are recorded in the delivery journal, never inferred from
an interrupted run. PostgreSQL's own startup recovered the private fixture after
the interruption; no PID/data file was manually removed or other service restarted.

Manual computer-use inspection on a separate synthetic local production fixture
(4174/18014) checked 320/390/768/1440: readable wrapping, visible keyboard focus on
date/quantity controls, touch-sized controls, separate debt/maintenance state and
blocked close with unaccounted received maintenance. No horizontal overflow was
observed. The browser zoom shortcut did not change its viewport/DPR; 200% text
enlargement is verified by the production browser test and captures, not claimed
as native browser-menu zoom. Automated axe, emulated widths and desktop inspection
do not certify physical devices, screen readers or all usability.

## Preserved failures and handoff boundary

Earlier local attempts exposed fixture date/user/composition issues, migration
metadata expectations, a financial revision ordering issue and selectors. Each
original run/log remains retained; fixes preserve version/transaction/privacy
guards and assertions. Run12's payment race expected reconciled debt after a
correction; #12 correctly invalidates applications. The test now explicitly asserts
400.00 debt, 180.00 pending reconciliation and invalid deposit, rather than weakening
that guard. No failing test was skipped or timeout/CI policy relaxed.

Remote Quality must pass for the exact published head; absent/queued checks are
not PASS. Exact head, PR, run/check URLs, fingerprints, cleanup and independent
review remain in the shared delivery journal/checkpoint. This document does not
authorize merge, Project Done, lock release, production operations or later tasks.

## Independent review correction 1

Round0 review failed RET-01/RET-05 on head `3bdfab46c5868c88759dabfbb2aec03a2a0c7d8a`:
the final approval omitted third-party name/authorization, balance exception reason
and agreement type even though the immutable request included them. The correction
renders these exact values with understandable labels, plus versions, observation
and linked incident. It also removes repeated maintenance routing once all received
quantities are already routed, preserving physical release and backend guards.

Regression evidence (exclusive private `rop014-correction1-*` outputs):

- Component RED: five failures for the omitted fields and maintenance eligibility;
  GREEN: nine custody cases, including all three agreement types and partial routing.
- Real production browser RED390: old bundle omitted third-party name and repair
  type in two separate runs. GREEN390: both complete custody and repair/replacement/
  delay scenarios pass, asserting review text before confirmation and exact POST
  bodies, stored obligations, preserved receipt/refund and absence of page errors.
- That new flow also exposed an existing ROP-014 defect: POST201 agreement followed
  by a blank page because `PaymentHistory.after` was only incident metadata, not the
  complete financial snapshot expected by the financial UI. PostgreSQL regression
  RED asserts the full snapshot; corrected PG/API GREEN2 asserts before/after,
  preserved receipts and debt. The existing deterministic summary is used within
  the same transaction and allocation revision ordering, not a new business rule.
- An intermediate source-run16 correction flushed allocations before their required
  immutable history revision and failed the foreign key. Original logs are retained;
  source-run17 restores history-before-allocation order and supplies the unchanged
  distribution to the shared summary. No constraints or assertions were relaxed.
- Initial setup attempts found a new-test TypeScript overload and Prettier style;
  their original failures remain preserved, and only typing/formatting were fixed.

The complete prior outputs were copied before correction (2741 files; manifest
`8b41e0fcce6119a70b83e3a8a38da30cdb718974cf2591efcfec8b8b2c6a6330`), and
correction outputs copied again before the full matrix (48 files; manifest
`d7ec652fc3f3c5057cfc012cc79856f61970cb7e14535b1c0bc716adce75d7b8`).
Original source snapshots and CI/reviewer evidence remain in place.

Full final-candidate local/remote results, exact source fingerprints and cleanup
are recorded in the delivery journal. Round0 Quality run38171966802 validates only
3bdf, never the corrected head. This correction requires a new exact-head CI run
and independent re-review. Current computer-use inventory exposes no browser
(`listBrowsers=[]`, `iab` unavailable); no current interactive/native inspection is
claimed. Production Playwright keyboard/focus/axe/four-width captures and direct
visual inspection are recorded separately, without claiming physical-device or
screen-reader coverage or native browser zoom from 200% text enlargement.

Correction candidate `source-run17`: full PostgreSQL17/backend/infra **626 passed**,
two upstream deprecation warnings, 241.80s; Ruff check/format120 and mypy55 PASS.
Frontend ESLint/Prettier, **94 Vitest**, production build134 modules and npm audit0
PASS. Strict locked Linux/Windows dependency audits found no known vulnerabilities.
All 36 changed backend/frontend files match that source snapshot after CRLF
normalization; manifest SHA-256
`2bde42b3709abec2975248ef5b5eb5b2cc482c33ffad78b989df19d794bb650e`.
Full four-width browser matrix and remote exact-head CI are not inferred from the
focused GREEN; their final results are recorded separately in the delivery journal.

## Independent review correction 2 (final allowed round)

Round1 review failed RET-03/RET-06/RN-049 and RET-07 on
`b1035d21165f27bfeb264ec39d89809fde19725d`. Its method-level terms reproduction
was not a complete PostgreSQL financial flow. This correction adds that real flow:
confirmed historical deposit200 on total400, integral handover, permitted out-state
price increase to500, actual receipt/reconciliation500, settled summary, real
cleaning return, explicit maintenance routing and close. RED source-run19 changed
terms200/300 to250/250 and invalidated deposit/fully-paid on close. The production
fix includes completed among historical-confirmation states; no new receipt,
refund, reconciliation, obligation or commercial rule is created by close.
GREEN asserts complete unchanged financial DTO, terms, debt, receipts, versions,
immutable payment history and replay snapshots, while maintenance remains blocked.

The two existing custody browser cases reproduce the seed race with **two workers**:
RED390 one passed/one failed409 at contract issuance. The production company-version
guard is correct and unchanged. Contract/custody tests now request independent
UUID PostgreSQL schemas through the existing loopback-only synthetic harness.
Request-local service selection uses a context-local synthetic cookie, not a
production tenant or auth bypass. Only Alembic schema initialization is locked
because Alembic's migration context is process-global; tests and business requests
remain concurrent. A real PG/API regression runs two contexts concurrently,
preserves stale409/Origin403/cross-context-session401, rejects unknown fixture400,
checks independent company versions and verifies all three schemas are removed.
The matrix runner no longer forces workers1: it inherits Playwright configuration
(CI2/local4). Local full correction matrix uses CI=true and therefore two workers,
zero retries and unchanged assertions/timeouts. GREEN390 passes both custody flows
with two workers, not a sequential rerun.

Private correction2 backups precede reruns; prior correction1/reviewer/CI/failure
artifacts remain intact. Exclusive logs retain initial source18 pagination0 setup
failure separately from valid business RED19. Intermediate source20 passed the
close financial invariants but exposed an invalid latest-history-by-clock test
assumption; the test now selects the exact financial revision and still requires
complete snapshot equality. A Ruff long-comment failure was mechanically fixed.
An audit wrapper invocation attempted `uv run export` instead of `uv export`;
the failed export/missing-input audit are retained, followed by a separate correct
locked export and strict audit. None of these failures is represented as PASS.

Focused source21: six passed,21 deselected,two upstream warnings,8.26s. Browser
GREEN390: two passed/two workers/zero retries,40.5s. Full source22 PG/infra:
**628 passed**,two upstream deprecation warnings,264.22s; Ruff check/format121 and
mypy55 PASS. Frontend lint/format,94Vitest,production build134 and npm audit0 PASS;
strict locked Linux/Windows dependency audits report no known vulnerabilities.
Concurrent local matrix01 initially exposed two30s timeouts in320 (long existing
rental-change flow and a reservation-flow final screenshot),34 passed/two failed.
Its original logs/traces/captures remain preserved; concurrent backend load is
not asserted as the cause. No timeout, retry, assertion or worker count is relaxed.
The four-width result and any separately namespaced diagnostic/resumption are
recorded exactly in the journal, not represented as a wholly passing first run.
All144
production browser cases across320/390/768/1440, source/capture fingerprints,
exact-head remote CI and cleanup results are recorded separately in the shared
delivery journal/PR. Earlier626/144/CI38187266335 apply only to b103, not this round.
Computer-use unavailability and physical-device/screen-reader/native-zoom limits
from correction1 remain explicit; no new native interactive inspection is inferred
from Playwright or rendered screenshot inspection.

## Human-authorized additional correction3

The human explicitly authorized continuing with the same executor/reviewer and
all gates after correction2 exhausted the original two-correction allowance.
Prior negative results remain negative: Windows correction2 matrix137/144 passed;
native Linux01 **142/144**, Linux02 **138/144**. Linux02 produced40/44 selected
custody PNGs, not44; Linux01 images never substitute for missing Linux02 captures.
CI38207085230 passed on f5ab but did not override those local failures.

Readonly trace inspection distinguished intentional503 responses from observed
dependency503s. Custody traces remain disabled for privacy; the original failed
operations GET status and loss-decision response cannot be recovered or inferred.
Safe synthetic diagnostics now retain method, parameterized path, HTTP status,
timing and allowlisted backend request correlations, never payloads/cookies/tokens.
Operations reads assert HTTP200 before accessing their DTO, and confirmation
asserts HTTP200/201 alongside the existing visible-success assertion within the
same five-second feedback bound. No timeout/retry/worker/assertion was relaxed.

Diagnostic source24 custody desktop:2 passed29.5s, two workers. Source25 full
desktop:34 passed/two failed2.8m; the existing rental-change/reservation30s
timeouts remain preserved. Safe PostgreSQL wait sampling observed a queue of
exclusive users locks behind a commit waiting for WALWrite (~1.69s). This proves
contention, not that authentication alone explains every historical failure.

Deterministic source26 real PG/API RED holds an uncommitted custody idempotency
record's actor FK KEY SHARE; the authenticated operations read returns503 instead
of200. Only readonly identity now uses FOR SHARE, compatible with concurrent
reads/audit FK while still excluding account UPDATE/DELETE and exclusive writers.
Activity/logout/reset/deactivation keep their existing exclusive locks; session
refresh remains after acquiring the user lock. No permission, expiry, clock,
idle-activity rule or production timeout changes. Source27 GREEN:9 passed,
31 deselected,two upstream warnings8.64s. Eight combinations observe actual
pg_blocking_pids in both reader/writer orders for logout/deactivation/reset/activity;
they prove post-commit401 revocation, refreshed activity, unchanged12h absolute
expiry and no readonly idle extension. Audit overlap now returns200 with the
complete financial DTO, and the uncommitted synthetic record rolls back.

Private backups precede diagnostic/final runs; source24–29 and original logs are
retained in the task14 fixture. Final full gates, fingerprints, production browser
matrix/captures and exact-head CI are recorded separately in the delivery journal.
No result from source22/23 or old CI is claimed to validate correction3.
