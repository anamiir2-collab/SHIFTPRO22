# ShiftPro 5.2.1 — Shift Management & Smart Wallet PWA

تطبيق لإدارة الورديات والحضور وساعات العمل والرواتب والإجازات والتقارير والمحافظ الشخصية، بواجهة عربية أولًا ودعم كامل للإنجليزية. يعمل كتطبيق ويب تقدمي (PWA) ويمكن استخدامه دون اتصال بعد تحميل الملفات الأساسية.

A shift-management, attendance, payroll, leave, reports, and personal-wallet PWA with Arabic-first RTL support and English LTR support. The app can work offline after its application files are cached.

## Current NOVA assistant

NOVA is a **local, text-only task assistant**. It provides tappable task options and routes supported requests to existing ShiftPro functions through `js/assistant-router.js`.

- Task groups cover navigation, attendance and shifts, salary, wallet, leaves, reports, backup, settings, labor-law search, and help.
- Task buttons invoke existing application actions rather than simulating results.
- Check-in, check-out, financial changes, backup, and other consequential actions use confirmation where required by the router.
- Requests with missing required details ask the user to clarify.
- Unsupported or unavailable functions are identified clearly.
- NOVA does not call an external AI service, send chat messages to an AI provider, request microphone access, record audio, recognize speech, or read replies aloud.
- The assistant uses a strict allowlist of known intents. It does not execute generated JavaScript or arbitrary commands.

## Privacy and data handling

- ShiftPro's operational records are handled by the app's existing local storage and modules.
- NOVA invokes supported local application functions and does not send chat content or work records to an external AI service.
- NOVA has no voice input or spoken-response functionality.
- Backup files can contain personal, attendance, salary, and wallet data. Store exported backups securely.
- The privacy policy is available at [privacy-policy.html](./privacy-policy.html). Review it whenever app storage or integrations change.

The app may still load the site itself and optional font resources required by the current UI. See the privacy policy for details.

## Project structure

```
SHIFTPRO22/
├── index.html
├── manifest.json
├── service-worker.js
├── privacy-policy.html
├── package.json
├── css/
│   ├── style.css
│   ├── ios-style.css
│   ├── animations.css
│   ├── wallet.css
│   ├── law-reader.css
│   └── ai-assistant.css
├── js/
│   ├── app.js
│   ├── assistant-router.js
│   ├── ai-assistant.js
│   ├── storage.js
│   ├── storage-hybrid.js
│   ├── attendance.js
│   ├── calendar.js
│   ├── salary.js
│   ├── reports.js
│   ├── settings.js
│   ├── leaves.js
│   ├── backup.js
│   ├── wallet.js
│   ├── wallet-forms.js
│   ├── wallet-reports.js
│   ├── law-reader.js
│   └── data/                 # Egyptian labor-law dataset
├── locales/
│   ├── ar.js
│   ├── en.js
│   └── index.js
└── tests/
    ├── assistant.test.js
    └── utils.test.js
```

## Run locally

The frontend is a static site. From the repository root, run:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Service-worker features require HTTPS or localhost.

## Tests

Install the development dependencies and run the Jest suite:

```bash
npm install
npm test
```

Report only tests that were actually run. Browser-only flows, mobile layouts, and the deployed GitHub Pages version should also be checked in a real browser.

## Deployment

The GitHub Pages site for this repository is:

https://anamiir2-collab.github.io/SHIFTPRO22/

Push changes to the configured publishing branch to trigger the GitHub Pages deployment. The service-worker cache version must be incremented whenever cached app-shell assets change.

## Safety and maintenance notes

- Preserve the existing ShiftPro modules and local data formats when changing NOVA.
- Keep Arabic right-to-left and English left-to-right behavior consistent.
- Do not add API keys, tokens, passwords, or sensitive user data to frontend files.
- Do not claim a task succeeded unless the underlying function reports a result that supports that claim.
- Keep the privacy policy synchronized with the actual implementation.
