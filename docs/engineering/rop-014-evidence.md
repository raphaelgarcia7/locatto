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
