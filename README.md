# ShiftPro — Shift Management & Smart Wallet PWA

تطبيق متكامل لإدارة الورديات والحضور وساعات العمل والرواتب — **تجربة عربية أولاً**، يعمل بدون إنترنت، قابل للتثبيت (PWA) على Android و iOS و Desktop.

A complete shift-management, attendance, and salary-tracking PWA. **Arabic-first**, RTL by default, with English as a secondary language. Works fully offline after first load.

## Current Project Status

The repository has been updated to **v2.9.1+** with a **fully integrated NOVA assistant**. NOVA now routes natural-language requests (Egyptian Arabic, MSA, English) to **real application functions** through a new pure-function command router (`js/assistant-router.js`). Both local and API modes are active simultaneously:

- **Local mode** (zero configuration): handles navigation, attendance check-in/out (with confirmation), salary computation, wallet balances and listing, leaves, calendar day-details, undo/redo, language switching, theme toggling, settings-sheet opening, backup creation, CSV/JSON/PDF/XLSX exports, and **labor-law retrieval over `window.__LAW__`** — all by calling the existing public `SP*` module functions.
- **API mode** (optional, CodeCraft): when the user asks to *explain more* / *simplify*, NOVA calls CodeCraft (direct key OR via Cloudflare Worker) with a **strict system prompt grounded in the previously retrieved local text** — it never invents external facts, especially for labor-law questions.

### Recent updates (v2.9.1+)
- Added `js/assistant-router.js` — pure-function intent detector + executor with 30+ supported intents, Arabic normalization, date/time/amount extraction, and 22 adapter functions that call real `SP*` module functions safely.
- Rewrote `js/ai-assistant.js` to consume the router, render bilingual replies, and route "explain more" requests to CodeCraft with a grounding system prompt that uses the last retrieved local context (e.g. matched labor-law article).
- Added a new **NOVA AI Setup sheet** in `index.html` (Settings → مساعد NOVA الذكي) where the user enters a CodeCraft API key and/or Worker URL. The key is stored in `localStorage` only and is never committed to the repository. Local commands work without any key.
- Added i18n keys for the new sheet in `locales/ar.js` and `locales/en.js` (17 keys each, parity preserved).
- Bumped `service-worker.js` cache key to `shiftpro-shell-v2.9.1` and added `js/assistant-router.js` to the precache app shell.
- Bumped console version stamp in `js/app.js` and the About sheet to `v2.9.1`.
- Fixed the failing Jest test (`tests/utils.test.js` salary precision — now rounds to 2 decimals to match `SPSalary.computeSalary`).
- Added `tests/assistant.test.js` with 52 new tests covering intent detection (Arabic/English), execution against stub `SP*` modules, missing-parameter handling, confirmation gating, missing-module graceful failure, and `handle()` orchestrator end-to-end.

### Architecture

```
User message
   ↓
SPAssistantRouter.detectIntent(message, ctx)  ← PURE, no DOM, Jest-testable
   ↓
   ┌─ kind=local ──→ execute(intent, params, ctx, confirmed)
   │                   ↓ calls real SPStorage / SPAttendance / SPSalary / SPWallet /
   │                     SPLeaves / SPBackup / SPReports / SPPDF / SPiCal / SPi18n /
   │                     SPSettings / SPApp / SPUndoRedo / __LAW__
   │                   ↓ returns {reply, ok, action?}
   │
   ├─ kind=law   ──→ execute('law_search')  ← RAG over window.__LAW__
   │                   ↓ stores contextForApi for next "explain more"
   │
   └─ kind=api   ──→ CodeCraft API fallback
                       ↓ system prompt: "answer ONLY from the provided context;
                                          never invent external facts"
                       ↓ body: {message, model='claude-opus-4.8', max_tokens=600}
```

Key invariants:
- No `eval`, no dynamic JavaScript, no unsafe DOM manipulation.
- Every consequential operation (check-in/out, wallet add-tx, backup-overwrite, undo/redo) sets `needsConfirm=true` and the UI shows a confirm dialog first.
- Missing required parameters (date, amount) are surfaced via `missing: ['date']` so the UI can ask the user to clarify.
- If a required module is unavailable, `execute()` returns a graceful localized "feature unavailable" reply — never throws.
- The CodeCraft API key and Worker URL live in `localStorage`; they are never written to source files.
- All assistant replies and error messages are localized to the current `SPi18n.getLocale()`.

### NOVA setup

1. **Local mode works out of the box.** No API key required. Open the launcher (bottom-right floating robot) and type any command below.
2. **Optional: enable deeper explanations.** Open the More page → **مساعد NOVA الذكي / NOVA smart assistant**:
   - Paste your **CodeCraft API key** (starts with `cc_…`). It is stored only in your browser's `localStorage`. Get one at <https://codecraftapi.com/>.
   - (Optional) Provide a **Worker URL** if you deployed the bundled Cloudflare Worker (`worker/src/index.js`). When a Worker URL is set and no direct key is present, requests route through the Worker, keeping your key server-side.
   - Save. The status indicator changes to "Direct" or "Via Worker".

### Supported NOVA commands (examples)

| Intent (examples in Arabic) | What happens |
|---|---|
| `افتح التقارير` / `افتح المحفظة` / `افتح القانون` | Navigates to the requested tab via `SPApp.goToTab`. |
| `سجل حضور` / `سجل انصراف` | Asks for confirmation, then triggers `#checkinBtn` / `#checkoutBtn`. |
| `افتح تفاصيل يوم 12 يناير` | Opens the day sheet via `SPAttendance.openDaySheet`. |
| `احسب راتبي` / `ساعات الاوف تايم` / `الخصومات` | Computes the current pay period via `SPSalary.computeSalary`. |
| `رصيد المحفظة` / `اعرض المحافظ` | Reads `SPWallet.getData()` and lists balances. |
| `ضيف معاملة 50` | Extracts the amount, asks confirmation, opens the wallet add-transaction form. |
| `رصيد الإجازات` / `طلبات الإجازة` | Reads `SPLeaves.calculateBalances` / `getRequests`. |
| `اعمل نسخة احتياطية` | Asks confirmation, calls `SPBackup.createManualBackup`. |
| `تصدير json` / `تصدير csv` / `تقرير pdf` / `تقرير اكسل` | Triggers the appropriate export on `SPBackup` / `SPReports` / `SPPDF`. |
| `تراجع` / `redo` | Calls `SPUndoRedo.undo` / `redo`. |
| `غير اللغة للإنجليزي` / `غير الثيم` | Calls `SPi18n.setLocale` / cycles `theme` via `SPStorage.saveSettings`. |
| `افتح الورديات` / `افتح الإشعارات` | Opens the named settings sheet via `SPSettings.openSheetByName`. |
| `المادة 41` / `ساعات العمل` / `article 41` | RAG over `window.__LAW__` (Egyptian Labor Law No. 14 of 2025). Returns up to 3 matching article excerpts + book/chapter meta. Stores the result as context for a follow-up "explain more". |
| `اشرح اكتر` / `simplify` | Routes the previous local context to CodeCraft with a strict system prompt that forbids inventing external facts. The model may only restate or simplify the provided text. |
| `مساعدة` | Lists everything NOVA can do. |

---

## ✨ What's New in v2.3.0 (Historical release notes)

This release delivers a comprehensive redesign, an Arabic-first experience, and a robust fix for the previously-broken General Settings sheet.

### 🔧 Critical Bug Fix: General Settings
**Root cause:** `openSettingsSheet()` in `js/settings.js` crashed at line 142 with `TypeError: Cannot set properties of null (setting 'value')` because the `#inpFontSize` element lives in the **App-Control sheet**, not in the General Settings sheet. The crash happened *before* the sheet could be shown — so users perceived Settings as completely dead. The same null-ref bug existed in `saveSettings()`. Both are now null-safe, and every `init()` binding was hardened via a `bind()` helper that warns instead of crashing.

### 🌍 Arabic-First Localization
- Fresh installs now open in **Arabic with RTL** — `i18n.readStored()` no longer falls back to `navigator.language`, only respects an explicitly saved preference.
- Switching to English (and back to Arabic) translates the **entire interface** without reload: nav labels, greetings, settings sections, sheet titles, buttons, dates, currencies, etc.
- Added `data-i18n` attributes to all bottom-nav labels.

### 👋 Personalized Welcome Message
- New `welcome-card` hero on the dashboard: time-based greeting + **personalized welcome line** (`مرحباً يا [Name]` / `Welcome, [Name]`) + contextual sub-greeting (`نتمنى لك يوماً منظماً ومليئاً بالإنجاز`) + avatar initial.
- Updates dynamically whenever the user saves a new name in Settings — no reload needed.

### 🕐 Redesigned Clock
- The legacy standalone clock card was merged into the welcome-card as a `clock-date-row` block, positioned beneath the greeting and above the check-in buttons.
- Live time (tabular-nums) | vertical divider | weekday + Gregorian date + Hijri underneath.
- No duplicate timers — the existing `SPClock` 1s `setInterval` continues to drive updates, paused on `visibilitychange`.

### ⚙️ Reorganized General Settings
Six clearly labeled sections with icons:
- **A. Personal Information** — name, job, employee ID, company
- **B. Salary & Compensation** — method, salary, monthly hours, shift hours, hourly rate
- **Overtime** — enable, multiplier, threshold
- **Deductions** — absence, late, grace
- **C. Shifts & Attendance** — pay cycle day + shortcut to Shift Manager
- **More Settings** — in-sheet quick-links to Date/Time, Notifications, App Control, and Backup sheets (no sheet stacking — `openSheetByName` closes the previous sheet first)

### 🎨 Premium Navy Color System
Centralized palette in `css/style.css`:

| Token | Light | Dark |
|-------|-------|------|
| Primary navy `--sp-navy` | `#1E2A44` | `#1E2A44` |
| Secondary blue `--sp-blue` | `#547AA5` | `#547AA5` |
| Accent blue `--sp-accent-blue` | `#A9C7E8` | `#A9C7E8` |
| Background `--sp-bg` | `#F5F7FA` | `#0F1626` |
| Card `--sp-card` | `#FFFFFF` | `#18223A` |
| Primary text `--sp-text` | `#202B3C` | `#E8EDF5` |
| Secondary text `--sp-muted` | `#6B778A` | `#8B95A8` |
| Border `--sp-border` | `#E3E8EF` | `#2B3852` |
| Success `--sp-success` | `#278568` | `#4FAA89` |
| Warning `--sp-warning` | `#C58A32` | `#E0A855` |
| Danger `--sp-danger` | `#C84C4C` | `#E07070` |

Dark mode is **carefully crafted** — not pure black; cards stay distinguishable from background; all text/icons/status colors remain readable; auto theme follows OS preference via `prefers-color-scheme`.

### 🎬 Refined Animations & Micro-Interactions
- Welcome-card fade-and-slide entrance, cascaded across greeting/name/sub/clock-row
- Settings-section cascade with `nth-child` staggered delays
- Sheet slide-up + overlay fade-in
- Button press feedback (`transform: scale(.97)`)
- Bottom-nav navy active-tab indicator bar above the icon
- Global `prefers-reduced-motion` guard disables all animations for users who prefer reduced motion

### 🔤 Arabic-First Typography
- Font stack: **Cairo** + **IBM Plex Sans Arabic** + system fallbacks (Segoe UI / Noto Sans Arabic / Tahoma / Arial).
- Preconnects to Google Fonts; falls back gracefully when offline.

### 🧭 Bottom Navigation Polish
- Active-tab indicator: small navy bar above the icon with a subtle shadow
- Label color shift on active (navy in light, accent-blue in dark)
- Icon drop-shadow, blur backdrop on the bar
- Safe-area handling respected

### 🐛 Other Bug Fixes
- Fixed a malformed `<svg <img` tag in the More-tab button that was breaking the bottom-nav DOM parser.
- Fixed `SPi18n.setLocale()` order — `apply(document)` now runs BEFORE subscribers so subscribers (like `renderDashboard()`) can overwrite the static greeting with the time-based one.
- Topbar gear icon now opens General Settings directly (was opening App-Control).

---

## 📁 Project Structure

```
SHIFTPRO22/
├── index.html              # Main page structure (Dashboard / Calendar / Salary / Reports / More)
├── manifest.json           # PWA manifest (Arabic, RTL, navy theme)
├── service-worker.js       # Offline app shell cache + cache-version invalidation
├── README.md               # This file
├── .gitignore              # Git ignore rules
├── package.json            # Project metadata
├── favicon-32.png          # Favicon 32×32
├── icon-192.png            # PWA icon 192×192
├── icon-512.png            # PWA icon 512×512
├── apple-touch-icon.png    # iOS touch icon 180×180
├── css/
│   ├── style.css           # Core UI, Premium Navy palette, dark mode
│   ├── ios-style.css       # iOS-inspired layer (inherits from --sp-* tokens)
│   ├── animations.css      # Entrance animations, transitions, reduced-motion guard
│   ├── wallet.css          # Smart Wallet interface
│   ├── law-reader.css      # Egyptian Labor Law reader styles
│   └── ai-assistant.css    # NOVA robot and assistant chat UI
├── js/
│   ├── utils.js            # Helpers: date, Hijri, format, toast, confirmDialog
│   ├── storage.js          # localStorage layer with v1 → v2 migration
│   ├── storage-hybrid.js   # IndexedDB hybrid backup layer
│   ├── clock.js            # Live Cairo-time clock (single 1s interval)
│   ├── official-holidays.js # Egyptian official + Islamic occasions
│   ├── calendar.js         # Smart calendar + bulk selection
│   ├── attendance.js       # Attendance system + Day Sheet
│   ├── salary.js           # Salary + overtime + deductions + bonuses
│   ├── reports.js          # Reports + charts + CSV/JSON/print
│   ├── settings.js         # Settings + shifts + leaves + stats + backup
│   ├── welcome-messages.js # Time-based/contextual welcome messages
│   ├── shift-templates.js # Shift templates + smart repeat
│   ├── leaves.js           # Leave management
│   ├── charts.js           # Donut + bar chart rendering
│   ├── backup.js           # JSON export/import + danger zone
│   ├── app-lock.js         # PIN / biometric lock
│   ├── smart-notifications.js # Local notifications
│   ├── undo-redo.js        # Undo/redo stack
│   ├── ux-enhancements.js  # UX polish (privacy mode, onboarding)
│   ├── ical-export.js      # iCal feed export
│   ├── pdf-export.js       # PDF report generation
│   ├── app.js              # Main coordinator (dashboard, splash, PWA)
│   ├── ai-assistant.js     # NOVA local commands + optional API chat
│   ├── wallet.js           # Smart Wallet core
│   ├── wallet-forms.js     # Smart Wallet entry forms
│   ├── wallet-reports.js   # Smart Wallet reports and summaries
│   ├── law-reader.js       # Egyptian Labor Law reader
│   └── data/               # Labor Law dataset split into chapter files
├── worker/                 # Optional Cloudflare Worker backend for AI chat
│   ├── src/index.js        # API proxy with origin/message validation
│   ├── wrangler.toml       # Worker deployment settings
│   ├── package.json        # Wrangler scripts/dependency
│   └── README.md           # Worker setup and security notes
├── locales/
│   ├── ar.js               # Arabic dictionary (default)
│   ├── en.js               # English dictionary
│   └── index.js            # i18n engine: t(), setLocale(), apply(), Intl formatting
├── assets/
│   ├── home.svg            # Bottom-nav icons (rendered with currentColor)
│   ├── schedule.svg
│   ├── salary.svg
│   ├── report.svg
│   └── application.svg
└── tests/
    └── utils.test.js       # Unit tests for SPUtils
```

---

## 🚀 Running Locally

ShiftPro is a static site — no build step, no backend, no dependencies to install.

### Option 1: Python's built-in server (simplest)
```bash
cd SHIFTPRO22
python3 -m http.server 8000
```
Open http://localhost:8000/ in your browser.

### Option 2: Node's `serve` (if Node.js is installed)
```bash
npx serve SHIFTPRO22
```

### Option 3: VS Code Live Server extension
Right-click `index.html` → "Open with Live Server".

### Option 4: Open `index.html` directly
You can also just double-click `index.html` to open it via `file://`, but the service worker won't register in that mode (it requires http/https). Everything else works.

> **Tip:** For full PWA testing (install prompt, offline cache, notifications), use `http://localhost:8000` — service workers require a secure context (localhost counts as secure).

---

## 🌐 Deploying to GitHub Pages

### Step-by-step

1. **Create a new GitHub repository** (e.g. `SHIFTPRO22`), or use the existing one at `anamiir2-collab/SHIFTPRO22`.

2. **Push the project files to the repository root:**
   ```bash
   cd SHIFTPRO22
   git init
   git remote add origin https://github.com/<your-username>/SHIFTPRO22.git
   git add .
   git commit -m "Initial commit: ShiftPro v2.3.0 Premium Navy Edition"
   git branch -M main
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - Go to your repo on GitHub → **Settings** → **Pages** (left sidebar).
   - Under "Source", select **Deploy from a branch**.
   - Choose **`main`** branch and **`/root`** folder.
   - Click **Save**.

4. **Wait ~1 minute** for the build to finish. Your site will be live at:
   ```
   https://<your-username>.github.io/SHIFTPRO22/
   ```

5. **For the existing repo** (`anamiir2-collab/SHIFTPRO22`), simply pushing the updated files to `main` will trigger a redeploy. The cache-busting version (the current asset version on all CSS/JS script tags) ensures GitHub Pages serves the latest version, not a stale cached one.

### Notes on GitHub Pages specifics
- GitHub Pages serves over HTTPS by default — perfect for service workers and PWA installation.
- The relative paths (`./index.html`, `./css/style.css`, etc.) ensure the app works whether deployed at the repo root or at a sub-path.
- The `manifest.json` `start_url` is `./index.html` and `scope` is `./`, so the PWA installs cleanly on a project-page URL.

---

## 🧪 Verifying the Build

After deploying, verify these flows:

1. **Fresh install opens in Arabic + RTL** — clear localStorage and reload.
2. **General Settings opens** — click the gear icon in the topbar (it should open the General Settings sheet, not the App-Control sheet).
3. **Save your name** — the dashboard greeting should update to `مرحباً يا [YourName]` immediately.
4. **Switch language** — More → App Control → Language. The entire interface should translate instantly without reload.
5. **Switch theme** — More → App Control → Theme. Light / Dark / Auto should all work; Auto follows OS.
6. **Salary calculation** — Open the Salary tab. With default settings (6000 EGP / 208 monthly hours), the rate should be `28.85 EGP/hr`.
7. **No horizontal overflow** — Open Chrome DevTools mobile emulation (iPhone 14, 390px) and verify `scrollWidth === clientWidth`.
8. **NOVA assistant — local mode (no API key):**
   - Click the floating robot button (bottom-right).
   - Try: `افتح التقارير`, `احسب راتبي`, `رصيد المحفظة`, `المادة 41`, `سجل حضور` (cancel the confirm).
   - Each should reply with a real action or computed data; no "I don't understand" if you used a supported command.
   - Type `مساعدة` to see the full capabilities list.
9. **NOVA assistant — API mode (optional, requires CodeCraft key):**
   - Open More → مساعد NOVA الذكي, paste a `cc_…` key, save.
   - Ask: `المادة 41`, then `اشرح اكتر` — the API should reply by simplifying the matched article text only, not by inventing external facts.
10. **Run the test suite:** `npm install && npm test`. Expected: 131 tests passing across `tests/utils.test.js`, `tests/wallet.test.js`, and `tests/assistant.test.js`.

---

## 🛡️ Privacy & Security

- **Core app data:** attendance, salary, settings, and leave data are designed to remain on the user's device using browser storage/IndexedDB, unless a feature explicitly exports or shares it.
- **Assistant local mode:** all deterministic NOVA commands (navigation, salary computation, wallet balances, leaves, backup, exports, language/theme, law RAG) run **fully on-device**. No network call is made for these. The Egyptian Labor Law text is bundled with the app (`js/data/*.js`) and searched locally.
- **Assistant API mode (optional):** when the user explicitly types "اشرح اكتر" / "explain more", the previously retrieved local text (e.g. matched labor-law article) and the user's message are sent to CodeCraft. The system prompt forbids inventing external facts. Configure via More → مساعد NOVA الذكي.
- **API key storage:** the CodeCraft API key is stored in the browser's `localStorage` only. It is never written to source files or committed to Git. Anyone with access to the browser profile can still read it via DevTools — use a disposable, low-limit key for testing, and prefer the Cloudflare Worker approach for production.
- **Production setup:** deploy the bundled Cloudflare Worker (`worker/src/index.js`) and store `CODECRAFT_API_KEY` as a Worker secret. Set `ALLOWED_ORIGIN` to your exact deployment origin. The Worker proxies requests to CodeCraft server-side, keeping the key out of the browser entirely. Never put a production key in frontend JavaScript, HTML, CSS, or committed files.
- **No analytics are intentionally added by the assistant changes.** External resources such as Google Fonts and any explicitly configured AI endpoint may make network requests.
- **Offline support:** the service worker caches the app shell and static assets. External AI chat requires network access; supported local app functions do not require an AI API.

---

## 📦 What's in this ZIP

- All application source files (HTML, CSS, JS, locales, assets, PWA icons, manifest, service worker)
- This README.md
- A `.gitignore` file
- The `tests/` folder with unit tests

**Excluded:**
- `.git/` directory
- `node_modules/` (not present — no JS dependencies)
- OS metadata (`.DS_Store`, `Thumbs.db`)
- Editor config (`.vscode/`, `.idea/`)
- Logs and debug files

---

## 🔧 Technical Stack

- **HTML5 + CSS3 + vanilla JavaScript (ES2015+)** — no framework, no build step.
- **CSS Custom Properties (variables)** — centralized theming.
- **Service Worker** — offline cache with network-first for navigations, cache-first for static assets.
- **Web Manifest** — installable PWA.
- **`Intl.DateTimeFormat`** — locale-aware date/time/Hijri formatting.
- **`localStorage` + `IndexedDB`** — hybrid storage with auto-migration from v1.

**Browser support:** Any modern browser that supports Service Workers and `Intl.DateTimeFormat` (Chrome 78+, Firefox 78+, Safari 14+, Edge 88+). Works on Android, iOS, and Desktop.

---

## 🧭 Recent Tasks & Roadmap

### Recent work
- **NOVA (نوفا):** animated robot icon, personal introduction, employee-name greeting, periodic help bubble, Arabic/English UI, suggested prompts, browser speech-to-text input where supported, and optional spoken replies using browser speech synthesis.
- **Egyptian Labor Law integration:** NOVA now searches the law dataset already loaded by ShiftPro (`window.__LAW__`) and returns up to three matching article excerpts with article/book/chapter labels. This lookup works locally without an AI API and warns users to verify the full official text; it is text retrieval, not legal advice.
- **Local actions without API:** NOVA has starter commands plus local legal-text search. It still does not execute every ShiftPro feature and should not invent a legal answer when no relevant passage is found.
- **Smart Wallet:** wallets should be user-defined (name, amount, and what each wallet covers), without forced percentage splits or mandatory preset categories. ShiftPro should organize and monitor the user's choices.
- **Optional AI backend:** Cloudflare Worker scaffold for server-side API calls, plus a development-only browser key entry path.
- **PWA refresh:** assistant stylesheet version and service-worker cache key updated for the latest files.

### Next tasks
1. Connect NOVA to more real application functions for shifts/calendar, attendance, salary, reports, wallets, profile, and settings.
2. Improve legal search relevance and test common questions against the loaded articles; make sure every answer points to the right provision and review the dataset for updates.
3. Require confirmation for sensitive writes/deletes and verify the action succeeded before telling the user it did.
4. Add tests for Arabic/English command variants, unavailable controls, cancelled confirmations, unknown commands, offline mode, and API/CORS failures.
5. Deploy and test the optional Worker end-to-end before enabling external chat for public users.
6. Review privacy and Google Play disclosures before public release.

## 📜 Version History

- **v2.9.1+ NOVA full integration** — new `js/assistant-router.js` (pure-function intent detector + 22 executors calling real `SP*` module functions); rewrote `js/ai-assistant.js` to consume the router; added NOVA AI Setup sheet for CodeCraft key/Worker URL; strict API system prompt grounded in last retrieved local context; 52 new Jest tests; fixed salary precision test; bumped service-worker cache key.
- **v2.9.0 NOVA voice support** — microphone speech-to-text where supported by the browser, optional spoken replies, local law search, and refreshed service-worker cache.
- **v2.7.0 assistant prototype** — NOVA assistant UI, starter local commands, optional CodeCraft/Worker integration scaffold.
- **v2.5.2** — Premium Navy redesign, Arabic-first default, General Settings fix, welcome card + merged clock, settings section reorganization, dark mode palette, refined animations.
- **v2.2.0** — iOS-style refresh, hybrid storage migration, official holidays, smart notifications.
- **v2.1.0** — Leave management, iCal export, undo/redo.
- **v2.0.0** — Complete rewrite with PWA support, dark mode, advanced reports.
- **v1.0.0** — Initial shift calendar.

---

## 👨‍💻 Developer

**أمير أنور** — 01066227553

---

## 📄 License

This project is provided as-is for personal and commercial use. All data stays on the user's device.
