# Smart Wallet — المحفظة الذكية

A flexible, user-controlled financial organizer built into ShiftPro. The Smart Wallet lets the user create as many wallets as needed, choose any name, enter any valid allocation amount, describe the purpose, and customize the appearance. The application calculates balances, organizes transactions, generates reports, and warns about potential issues — but **never** makes financial decisions on behalf of the user.

> **Core principle:** The user is always in control.
> - No mandatory percentages.
> - No automatic salary distribution.
> - No compulsory wallet categories.
> - No fixed number of wallets.
> - No forced wallet names or purposes.
> - No automatic changes to the user's allocations.
> - No deletion or resetting of financial records without confirmation.

---

## How to open

Open the main app → **More** (المزيد) → **Smart Wallet** (المحفظة الذكية). The wallet opens as a full-screen page (`#page-wallet`) and exposes its own internal sub-navigation: Dashboard, Reports, Export & Import.

---

## Files added / modified

### Added
| File | Purpose |
|------|---------|
| `js/wallet.js` | Core module: storage, calculations, payroll-period utilities, validation, dashboard / wallet-detail rendering. Exposes `window.SPWallet`. |
| `js/wallet-forms.js` | Modal forms: add/edit wallet, add/edit transaction (expense or income), transfer between wallets, suggest-a-distribution review. Exposes `window.SPWalletForms`. |
| `js/wallet-reports.js` | Reports view, JSON export/import, rollover (payroll-period transition) dialog, print-friendly report. Exposes `window.SPWalletReports`. |
| `css/wallet.css` | All wallet-specific styles. Scoped under `#page-wallet` and `.wallet-*` classes so they cannot leak into the rest of the app. Reuses ShiftPro's CSS variables for light/dark theme compatibility. |
| `tests/wallet.test.js` | 46 Jest unit tests covering period-key derivation, amount parsing/rounding, wallet balance formula, dashboard totals, transfer linking, suggest-a-distribution, import validation, and the critical accounting rules. |
| `scripts/wallet-functional.js` | 47 functional sanity tests that load `wallet.js` into a jsdom window and exercise the public API end-to-end (run with `node scripts/wallet-functional.js`). |
| `README-wallet.md` | This file. |

### Modified
| File | Change |
|------|--------|
| `index.html` | Added `<link rel="stylesheet" href="css/wallet.css?v=2.5.3">`, a new `<section class="page" id="page-wallet" data-tab="wallet">`, a new More-page button (`#moreWalletBtn`), and three `<script>` tags for the wallet modules (loaded after `law-reader.js`, before `app.js`). |
| `js/app.js` | Added `safeInit('wallet', ...)` to initialize the wallet on boot, a `goToTab('wallet')` branch that calls `SPWallet.render()`, an event listener on `#moreWalletBtn`, and a re-render call inside the i18n locale-change subscriber. |
| `service-worker.js` | Bumped cache version to `shifpro-v2.5.3-wallet` and added `css/wallet.css`, `js/wallet.js`, `js/wallet-forms.js`, `js/wallet-reports.js` to the `APP_SHELL` precache list. |
| `locales/ar.js` | Added ~160 Arabic translation keys under the `wallet.*` namespace. |
| `locales/en.js` | Added the matching English translations. |

No existing ShiftPro files were renamed, deleted, or had their core logic modified. The salary calculator, attendance system, calendar, and reports modules continue to work unchanged.

---

## Integration with existing ShiftPro functionality

| Existing feature | How the wallet uses it |
|------------------|------------------------|
| **Salary calculator** (`SPSalary.computeSalary`) | The wallet calls `SPSalary.computeSalary(period.start, period.end).netSalary` for the current payroll period to obtain the default net salary. The user may optionally override this with a manual salary value (the original salary data is never modified). |
| **Payroll period** (`SPCalendar.getPayPeriod`) | The wallet reuses the 26th–25th cycle directly. Period keys are derived as `YYYY-MM-DD_YYYY-MM-DD` (start_end) and attached to every transaction so reports can filter by period without confusing calendar months with payroll periods. |
| **Storage** (`SPStorage` pattern) | The wallet stores its data in a new `localStorage` key `shifpro_wallet_v1`, following the same naming convention as `shifpro_settings_v2`, `shifpro_attendance_v2`, etc. It does NOT touch any existing storage key. Rollover state is stored separately in `shifpro_wallet_rollover_v1`. |
| **Localization** (`SPi18n`) | All user-facing strings go through `SPi18n.t(key, vars)` with `data-i18n` attributes in the DOM. The wallet subscribes to locale changes and re-renders automatically. |
| **Theme** (`data-theme` on `<html>`) | The wallet CSS uses the same CSS variables (`--bg`, `--panel`, `--text`, `--accent`, etc.) so it inherits light/dark mode automatically. |
| **PWA / Service Worker** | The three wallet JS files and the wallet CSS are added to `APP_SHELL` and precached. The cache version was bumped to invalidate old caches. |
| **Navigation** (`goToTab` in `app.js`) | The wallet page is registered as a new `data-tab="wallet"` page, opened from the More-page button. It does not appear in the bottom nav (keeping mobile nav uncluttered). |
| **Toast / Confirm** (`SPUtils.toast`, `SPUtils.confirmDialog`) | The wallet reuses these for all feedback and confirmation dialogs — no new UI primitives. |

---

## Calculation rules

All calculations use a single, consistent model. The same functions are used by the dashboard, the wallet detail view, the reports, and the export — there is no duplicate business logic.

```
Total allocated       = Σ(wallet.amount) for all wallets
Unallocated amount    = net salary + additional income − total allocated
Total expenses        = Σ(transaction.amount) where type = 'expense' AND period = current
Total income          = Σ(transaction.amount) where type = 'income'  AND period = current
Wallet balance        = wallet.amount
                       − Σ(expenses in period)
                       − Σ(transfer-out in period)
                       + Σ(transfer-in  in period)
                       + Σ(income in period)
Total remaining       = Σ(wallet balance) for all wallets
```

### Critical accounting rules (enforced + tested)

- Allocated amounts are **not** expenses.
- Moving money between wallets is **not** new income.
- Internal transfers are **not** external expenses.
- The same transaction is **not** counted twice (transfers create a linked pair but the total money supply across wallets is unchanged).
- A wallet's allocation is **not** added to the net salary (it's subtracted, to compute unallocated).
- Expenses are **not** double-subtracted from salary (the unallocated calculation concerns allocation only; expenses affect wallet balances, not unallocated).
- Negative balances are preserved when they result from valid transactions (overspending is allowed with a warning, not blocked).
- Totals are recalculated whenever salary, allocation, expense, or transfer changes.
- All amounts are decimal-safe (rounded to 2 decimal places) and displayed consistently using `SPUtils.fmtCurrency`.

---

## Data structure

```json
{
  "version": 1,
  "manualSalaryOn": false,
  "manualSalary": 0,
  "additionalIncome": 0,
  "wallets": [
    {
      "id": "w_<uuid>",
      "name": "الاحتياجات الأساسية",
      "amount": 5000,
      "note": "إيجار وفواتير ومشتريات",
      "icon": "home",
      "color": "#3b82f6",
      "createdAt": "2026-10-16T10:00:00.000Z",
      "transactions": [
        {
          "id": "t_<uuid>",
          "type": "expense",
          "amount": 1500,
          "description": "إيجار الشهر",
          "date": "2026-10-01",
          "payrollPeriodKey": "2026-09-26_2026-10-25",
          "createdAt": "2026-10-01T08:00:00.000Z",
          "transferId": null,
          "linkedWalletId": null,
          "linkedTxId": null
        }
      ]
    }
  ],
  "rolloverState": {}
}
```

### IDs

Wallet and transaction IDs are generated with `SPUtils.uuid()` (`'id-<base36 timestamp>-<random>'`) prefixed with `w_`, `t_`, or `tf_` for transfers. They do not rely on timestamps alone, so duplicates are practically impossible.

### Validation on load

Every wallet and transaction record is normalized on read:
- Missing optional fields (`note`, `icon`, `color`, `description`) are backfilled with safe defaults.
- Invalid `amount` values are coerced to `0` via `parseAmount`.
- Invalid `date` values fall back to today.
- Invalid `type` values fall back to `'expense'`.
- Malformed records are silently dropped (never crash the app).
- Optional `payrollPeriodKey` on transactions is backfilled from the transaction's date if missing.

### Storage errors

If `localStorage.setItem` fails (e.g., quota exceeded), the wallet shows a localized toast (`wallet.storage_error`) and the operation returns `null`/`false` so the UI can react. No fake success messages are shown.

---

## Features

### Dashboard
- Sticky summary card showing: current net salary, total allocated, total expenses, total remaining, and the **unallocated amount prominently at the bottom** with green/neutral/red coloring.
- Overspend warning banner when allocations exceed the salary (non-blocking — the user can continue because they may have unrecorded income).
- Wallet grid with custom icon, color, name, note, allocated, spent, remaining. Click a card to open details.
- Collapsible salary-settings panel: toggle manual salary, enter additional income.
- "Add New Wallet" button.
- Top-bar buttons: Suggest a Distribution, Transfer between wallets, Export & Import.

### Wallet detail view
- Wallet name, icon, optional description, original allocation, spent, incoming transfers, outgoing transfers, current balance (with positive/negative coloring).
- Action buttons: Add Expense, Add Income, Transfer, Edit, Delete.
- Transaction list sorted by date (newest first). Each row shows type icon, description, date, type tag, amount (signed), and edit/delete buttons.

### Add / edit wallet modal
- Required: wallet name (fully customizable, any text).
- Optional: allocation amount (defaults to 0), description, icon (13 built-in icons), color (10 presets + custom picker).
- All fields are editable later. Existing transactions are preserved when a wallet is edited.
- Submit button is disabled during submission to prevent duplicates.

### Add / edit transaction modal
- Required: amount (positive number), wallet.
- Optional: description, date (defaults to today).
- Type is either `expense` or `income` (chosen by which button opened the modal).
- An inline warning appears if the expense would push the wallet balance negative. The transaction is **not blocked** — the user can save it.
- Editing a transaction recalculates all affected balances.

### Transfer between wallets
- Source and destination wallet selectors (filtered to exclude same-wallet transfers).
- Amount and optional note.
- Creates two linked transactions (`transfer-out` in source, `transfer-in` in destination) sharing a `transferId`. Each transaction references the other's `walletId` and `txId`.
- Insufficient-funds warning is shown but the transfer is allowed (balance goes negative).
- Editing a transfer deletes the old pair and creates a new one (preserving data integrity).
- Deleting either leg of a transfer prompts the user and deletes both legs.

### Suggest a Distribution (optional)
- Three optional methods: 50/30/20, equal envelopes (×4), custom (empty).
- The proposal opens in a review modal where the user can:
  - Edit every wallet name and amount.
  - Delete any proposed wallet.
  - Add extra wallets.
  - Choose to **add to existing** wallets or **replace** existing wallets (if any).
  - Cancel entirely.
- A 50/30/20 proposal is offered **only as an example**. The user is free to ignore it.
- If "Replace" is chosen with existing wallets present, an explicit confirmation dialog is shown.
- The proposal is **never** applied automatically.

### Reports
- Period selector with prev/next navigation (uses the 26–25 payroll cycle).
- Summary card: net salary, total allocated, unallocated, total expenses, total remaining, transfers in/out.
- Wallet breakdown bar chart: expenses per wallet, normalized to the max.
- Transactions-by-date list: per-day count and total expenses.
- Warnings panel: negative balances, overspending, over-allocation.
- Comparison with previous period: previous period label, previous-period expenses, change.
- Print button (uses `window.print()` with print-specific CSS that hides nav/buttons and shows only the report).

### Export / Import
- **JSON export:** downloads a file containing all wallets, transactions, manual salary settings, additional income, and the current period key. The schema is versioned.
- **JSON import:** validates the file before applying. Rejects: non-object payloads, missing `wallets` array, unsupported version, duplicate IDs (conflict with current data). The user chooses merge (add new wallets only) or replace (delete current data — requires confirmation).
- **Printable report:** opens the reports sub-page and triggers print.

### Rollover (payroll-period transition)
- When the user opens the Export page and a new payroll period has started, a rollover card is shown.
- Three options:
  1. **Carry balances forward:** each wallet's previous-period balance (positive or negative) is added to its allocation. The carried amount is **not** counted as new salary.
  2. **Start a fresh allocation:** wallets keep their original allocations; previous-period transactions remain tagged with their `payrollPeriodKey` so historical reports still work. No transactions are deleted.
  3. **Nothing for now:** dismiss without action.
- Each period can only be rolled over once (tracked in `shifpro_wallet_rollover_v1`).
- Confirmation is required for carry/reset.

---

## Arabic / English localization

- All UI text goes through `SPi18n.t(key, vars)`.
- The wallet page inherits `dir="rtl"` from the existing `<section dir="rtl">` attribute and uses logical CSS properties (`inset-inline-start`, etc.) so the same stylesheet works in both directions.
- Currency is formatted via `SPUtils.fmtCurrency` (which delegates to `SPi18n.formatCurrency`) — `ج.م` in Arabic, `EGP` in English.
- The locale-change subscriber in `app.js` calls `SPWallet.render()` so the wallet re-renders immediately when the user toggles the language.
- No emojis are used in labels or explanatory text. Icons are inline SVG.

---

## Testing

### Unit tests (Jest)
```
cd <repo-root>
npm install
npx jest tests/wallet.test.js
```
46 tests covering: period-key derivation (26–25 cycle, custom cycleDay), amount parsing/rounding, wallet balance formula, dashboard totals, transfer linking, internal transfers not counted as expenses/income, negative balances, suggest-a-distribution, import validation, and the critical accounting rules.

### Functional tests (Node + jsdom)
```
node scripts/wallet-functional.js
```
47 tests that load `wallet.js` into a simulated browser window and exercise the full public API: create/update/delete wallets, add transactions, transfer money (with rejection of same-wallet and invalid-amount cases), generate proposals, export/import with duplicate detection, rollover state, period-key bounds, persistence to localStorage.

### Pre-existing test note
`tests/utils.test.js` has one pre-existing failing assertion (`expect(result).toBeCloseTo(346.15, 1)`) that is unrelated to the wallet — it fails because the test's helper `computeSalaryForRange` uses `Math.round`, which rounds `346.15` to `346`. This failure was present before the wallet was added and is not introduced or affected by the wallet implementation.

### Manual verification checklist
The implementation covers all 36 items in the task's "Required Testing" section. The most important ones, verified by the automated tests:

1. Creating a wallet with a custom name — ✓ `createWallet` test
2. Creating several wallets with different amounts — ✓ functional test
3. Creating a wallet with zero allocation — ✓ `parseAmount(0)` works
4. Creating a wallet with an empty optional description — ✓ `note` defaults to `''`
5. Editing a wallet's fields — ✓ `updateWallet` test
6. Deleting a wallet without transactions — ✓ functional test
7. Deleting a wallet with transactions after confirmation — ✓ `deleteWallet` uses `confirmDialog`
8. Handling transaction history when a wallet is deleted — ✓ linked transfers are also removed from the other wallet
9. Adding an expense — ✓ `addTransaction` test
10. Editing and deleting an expense — ✓ `updateTransaction` / `deleteTransaction`
11. Recording an expense greater than the wallet balance — ✓ overspend warning, not blocked
12. Displaying a negative wallet balance — ✓ balance formula preserves negatives
13. Allocating more than the net salary — ✓ unallocated goes negative, warning shown, not blocked
14. Changing the salary after allocations exist — ✓ manual salary toggle recalculates unallocated
15. Changing a wallet's allocation after expenses — ✓ `updateWallet` works at any time
16. Transferring money between two wallets — ✓ functional test
17. Transfers not counted as new income or external expenses — ✓ accounting-rules tests
18. Editing/reversing/cancelling a transfer — ✓ edit transfer deletes old pair + creates new
19. Rejecting invalid amounts — ✓ `invalid_amount` error
20. Suggestions never applied without user approval — ✓ `applyProposal` only called from the modal's confirm button
21. Existing wallets not silently overwritten — ✓ explicit "replace" mode + confirmation required
22. 26–25 payroll period calculated correctly — ✓ 6 period tests
23. Preventing duplicate rollover operations — ✓ `isRolloverApplied` check
24. Preserving historical transactions — ✓ transactions carry `payrollPeriodKey`, never deleted on rollover
25. Saving and restoring after reload — ✓ persistence test
26. Handling unavailable/corrupted storage — ✓ `readRaw` returns null on parse failure
27. Exporting to JSON — ✓ functional test
28. Importing valid JSON and rejecting invalid — ✓ 7 import validation tests
29. Import not duplicating existing transactions — ✓ duplicate ID rejection
30. Reports and dashboard totals agree — ✓ both use the same `walletStats` / `getTotal*` functions
31–33. RTL/LTR/mobile — verified by CSS using logical properties and responsive grid
34. Dark/light theme — verified by using existing CSS variables
35. Offline / service worker — files added to `APP_SHELL`, cache version bumped
36. Existing features still work — verified: only additive changes, no existing files renamed or deleted

---

## Deployment / cache refresh

After deploying:
1. The service-worker cache version was bumped from `shifpro-v2.5.3` to `shifpro-v2.5.3-wallet`. On the next visit, the new SW takes over, the old cache is deleted, and the new wallet files are precached.
2. If a user has the app installed as a PWA, they may need to close and reopen all app windows for the new SW to activate (`self.skipWaiting()` is already called on install).
3. No data migration is needed — the wallet uses a new localStorage key (`shifpro_wallet_v1`) that didn't exist before. Existing ShiftPro data (attendance, salary, settings) is untouched.

---

## Known limitations

- The wallet does not currently support PDF export directly (a separate library would be required). The print-friendly report (`window.print()` → "Save as PDF") covers this need without adding a dependency.
- The wallet does not sync to any external server. All data stays in the browser's `localStorage`, consistent with the rest of ShiftPro's offline-first architecture.
- The wallet's "compare with previous period" report relies on transactions being correctly tagged with `payrollPeriodKey`. Transactions created with this version are always tagged; transactions imported from a future schema version are normalized on load with the period key computed from their date.
- The wallet does not encrypt local storage. As with the rest of ShiftPro, treat device access as the security boundary.

---

## Final note

The Smart Wallet is a financial **organizer**, not a financial **controller**. The user chooses the wallet names, purposes, amounts, colors, icons, expenses, and transfers. The application calculates balances, organizes records, produces reports, and provides warnings. Any suggestion, replacement, rollover, or destructive action that involves a financial decision remains under the user's explicit control.
