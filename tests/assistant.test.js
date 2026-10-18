/**
 * ShiftPro Mero Assistant — Router tests.
 *
 * The router's `detectIntent` is a PURE function (no DOM, no SP* globals
 * required), so we can unit-test it end-to-end in Jest with zero mocking.
 * The `execute` function takes an injected `ctx` so we test it with stub
 * modules that record what was called.
 *
 * Run:  npx jest tests/assistant.test.js
 */

// ---------- Load the router into a fake `window`-like global ----------
const fs = require('fs');
const path = require('path');

const routerSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'assistant-router.js'),
  'utf8'
);

// The router attaches itself to the global it receives.
const sandbox = {};
const fn = new Function('window', 'global', 'self', routerSrc);
// Pass the same sandbox as window/global/self so `window.SPAssistantRouter`
// and `global.SPAssistantRouter` both resolve.
fn(sandbox, sandbox, sandbox);
const R = sandbox.SPAssistantRouter;

// ---------- Helpers ----------
function detect(msg) {
  return R.detectIntent(msg, {});
}

// ---------- Tests ----------
describe('Mero assistant router — module surface', () => {
  test('exposes detectIntent, execute, handle, and adapters', () => {
    expect(typeof R.detectIntent).toBe('function');
    expect(typeof R.execute).toBe('function');
    expect(typeof R.handle).toBe('function');
    expect(R._adapters && typeof R._adapters.execNav === 'function').toBe(true);
  });
});

describe('Mero assistant router — intent detection (Arabic)', () => {
  test('navigation intents', () => {
    expect(detect('افتح التقارير').intent).toBe('nav_reports');
    expect(detect('روح على الرئيسيه').intent).toBe('nav_dashboard');
    expect(detect('افتح الراتب').intent).toBe('nav_salary');
    expect(detect('افتح المحفظه').intent).toBe('nav_wallet');
    expect(detect('افتح القانون').intent).toBe('nav_law');
  });

  test('attendance intents mark consequential ops as needsConfirm', () => {
    const ci = detect('سجل حضور');
    expect(ci.intent).toBe('attendance_checkin');
    expect(ci.needsConfirm).toBe(true);
    expect(ci.kind).toBe('local');

    const co = detect('سجل انصراف');
    expect(co.intent).toBe('attendance_checkout');
    expect(co.needsConfirm).toBe(true);
  });

  test('open day details extracts the date', () => {
    const d = detect('افتح تفاصيل يوم 12 يناير');
    expect(d.intent).toBe('attendance_open_day');
    expect(d.params.date).toMatch(/^\d{4}-01-12$/);
    expect(d.missing).toEqual([]);
  });

  test('open day without date flags missing param', () => {
    const d = detect('افتح تفاصيل يوم');
    expect(d.intent).toBe('attendance_open_day');
    expect(d.missing).toContain('date');
  });

  test('salary intents', () => {
    expect(detect('احسب راتبي').intent).toBe('salary_compute');
    expect(detect('ساعات الاوف تايم').intent).toBe('salary_overtime');
    expect(detect('الخصومات').intent).toBe('salary_deductions');
  });

  test('wallet intents', () => {
    expect(detect('رصيد المحفظه').intent).toBe('wallet_balance');
    expect(detect('اعرض المحافظ').intent).toBe('wallet_list');
    const add = detect('ضيف معاملة 50');
    expect(add.intent).toBe('wallet_add_tx');
    expect(add.needsConfirm).toBe(true);
    expect(add.params.amount).toBe(50);
  });

  test('wallet add transaction flags missing amount', () => {
    const a = detect('ضيف معامله');
    expect(a.intent).toBe('wallet_add_tx');
    expect(a.missing).toContain('amount');
  });

  test('leaves intents', () => {
    expect(detect('رصيد الاجازات').intent).toBe('leaves_balance');
    expect(detect('طلبات الاجازه').intent).toBe('leaves_list');
  });

  test('backup intents', () => {
    const b = detect('اعمل نسخه احتياطيه');
    expect(b.intent).toBe('backup_create');
    expect(b.needsConfirm).toBe(true);
    expect(detect('تصدير json').intent).toBe('backup_export_json');
    expect(detect('تصدير csv').intent).toBe('backup_export_csv');
  });

  test('reports export intents', () => {
    expect(detect('تقرير pdf').intent).toBe('reports_export_pdf');
    expect(detect('تقرير اكسل').intent).toBe('reports_export_xlsx');
    expect(detect('تقرير csv').intent).toBe('reports_export_csv');
  });

  test('undo/redo intents', () => {
    expect(detect('تراجع').intent).toBe('undo');
    expect(detect('redo').intent).toBe('redo');
  });

  test('language & theme intents', () => {
    expect(detect('غير اللغه للانجليزي').intent).toBe('lang_en');
    expect(detect('عربي').intent).toBe('lang_ar');
    expect(detect('غير الثيم').intent).toBe('theme_toggle');
  });

  test('settings sheet intents', () => {
    expect(detect('افتح الورديات').intent).toBe('open_settings_shifts');
    expect(detect('افتح الاشعارات').intent).toBe('open_settings_notifications');
  });

  test('law search intent matches article queries', () => {
    expect(detect('المادة 41').intent).toBe('law_search');
    expect(detect('قانون العمل ساعات الشغل').intent).toBe('law_search');
    expect(detect('article 41').intent).toBe('law_search');
    expect(detect('working hours').intent).toBe('law_search');
  });

  test('explain-more intent is local-only', () => {
    const e = detect('اشرح اكتر');
    expect(e.intent).toBe('explain_more');
    expect(e.kind).toBe('local');
  });

  test('greetings and help', () => {
    expect(detect('السلام عليكم').intent).toBe('greeting');
    expect(detect('مساعدة').intent).toBe('help');
  });

  test('Arabic normalization: أ → ا, ى → ي, ة → ه', () => {
    // "الإعدادات" and "الاعدادات" should both match.
    expect(detect('افتح الإعدادات').intent).toBe('nav_settings');
    expect(detect('افتح الاعدادات').intent).toBe('nav_settings');
  });
});

describe('Mero assistant router — intent detection (English)', () => {
  test('navigation intents', () => {
    expect(detect('open reports').intent).toBe('nav_reports');
    expect(detect('go to dashboard').intent).toBe('nav_dashboard');
    expect(detect('open wallet').intent).toBe('nav_wallet');
    expect(detect('open law').intent).toBe('nav_law');
  });

  test('attendance intents', () => {
    expect(detect('check in').intent).toBe('attendance_checkin');
    expect(detect('check out').intent).toBe('attendance_checkout');
  });

  test('salary intents', () => {
    expect(detect('compute my salary').intent).toBe('salary_compute');
    expect(detect('overtime hours').intent).toBe('salary_overtime');
  });

  test('wallet intents', () => {
    expect(detect('wallet balance').intent).toBe('wallet_balance');
    expect(detect('list wallets').intent).toBe('wallet_list');
    const add = detect('add transaction 50');
    expect(add.intent).toBe('wallet_add_tx');
    expect(add.params.amount).toBe(50);
  });

  test('explain-more remains local-only in English', () => {
    const e = detect('explain more');
    expect(e.kind).toBe('local');
    expect(e.intent).toBe('explain_more');
  });
});

describe('Mero assistant router — unsupported & edge cases', () => {
  test('empty message is unsupported', () => {
    expect(detect('').kind).toBe('unsupported');
    expect(detect('   ').kind).toBe('unsupported');
  });

  test('random gibberish is unsupported', () => {
    const r = detect('xyzzy floob');
    expect(r.kind).toBe('unsupported');
    expect(r.intent).toBe('unknown');
  });

  test('detectIntent never throws on weird input', () => {
    expect(() => detect(null)).not.toThrow();
    expect(() => detect(undefined)).not.toThrow();
    expect(() => detect(123)).not.toThrow();
    expect(() => detect({foo:'bar'})).not.toThrow();
  });
});

// ---------- execute() tests with stub SP* modules ----------
describe('Mero assistant router — execute() with stubs', () => {
  function makeCtx(overrides) {
    const calls = [];
    const ctx = Object.assign({
      SPi18n: {
        getLocale: () => 'ar',
        setLocale: (l) => { calls.push({ fn: 'setLocale', args: [l] }); },
        formatCurrency: (n) => n + ' EGP',
        formatNumber: (n, d) => String(n)
      },
      SPUtils: { fmtDate: (d) => (d instanceof Date ? d.toISOString().slice(0,10) : d) },
      SPApp: { goToTab: (tab) => { calls.push({ fn: 'goToTab', args: [tab] }); } },
      SPAttendance: { openDaySheet: (date) => { calls.push({ fn: 'openDaySheet', args: [date] }); } },
      SPCalendar: { getPayPeriod: () => ({ start: new Date('2025-01-01'), end: new Date('2025-01-26') }) },
      SPSalary: {
        computeSalary: () => ({
          counts: { A: 20, X: 1, L: 1, B: 0, H: 0 },
          baseHours: 240, overtimeHours: 12, totalHours: 252,
          baseSalary: 5000, bonus: 200, allowance: 100,
          totalDeductions: 50, absenceDeduction: 0, lateDeduction: 0, advance: 50, deduction: 0,
          overtimeValue: 540, netSalary: 5250
        }),
        getOvertimeHourlyRate: () => 45
      },
      SPWallet: {
        getData: () => ({ wallets: [{ id: 'w1', name: 'تجميع', amount: 1000 }] }),
        getTotalAllocated: () => 1000,
        getTotalRemaining: () => 500,
        getTotalExpenses: () => 500,
        getTotalIncome: () => 0,
        walletStats: () => ({ balance: 500, expenses: 500 }),
        currentPeriodKey: () => '2025-01-01|2025-01-26'
      },
      SPLeaves: {
        calculateBalances: () => ({ annual: { used: 5, total: 21 }, casual: { used: 2, total: 7 } }),
        getRequests: () => []
      },
      SPBackup: {
        createManualBackup: (label) => { calls.push({ fn: 'createManualBackup', args: [label] }); return { id: 'snap1' }; },
        snapshot: () => { calls.push({ fn: 'snapshot' }); return { id: 'snap1' }; }
      },
      SPReports: {
        exportCSV: () => { calls.push({ fn: 'exportCSV' }); },
        exportReportXLSX: () => { calls.push({ fn: 'exportReportXLSX' }); }
      },
      SPPDF: {
        exportReportRange: () => { calls.push({ fn: 'exportReportRange' }); }
      },
      SPUndoRedo: {
        canUndo: () => true,
        canRedo: () => true,
        undo: () => { calls.push({ fn: 'undo' }); },
        redo: () => { calls.push({ fn: 'redo' }); }
      },
      SPStorage: {
        getSettings: () => ({ theme: 'light' }),
        saveSettings: (p) => { calls.push({ fn: 'saveSettings', args: [p] }); }
      },
      SPSettings: {
        applyTheme: () => {},
        openSheetByName: (n) => { calls.push({ fn: 'openSheetByName', args: [n] }); }
      },
      __LAW__: {
        preamble: [{ title: 'المادة الأولى', text: ['نص المادة الأولى'] }],
        books: [{ name: 'الكتاب الأول', articles: [{ num: 41, paras: ['نص المادة 41'] }] }]
      },
      _calls: calls
    }, overrides || {});
    return ctx;
  }

  test('nav_dashboard calls SPApp.goToTab("dashboard")', () => {
    const ctx = makeCtx();
    const res = R.execute('nav_dashboard', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'goToTab' && c.args[0] === 'dashboard')).toBe(true);
    expect(res.reply).toContain('فتحت');
  });

  test('salary_compute formats the breakdown', () => {
    const ctx = makeCtx();
    const res = R.execute('salary_compute', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('5000 EGP');          // base salary
    expect(res.reply).toContain('5250 EGP');          // net salary
    expect(res.reply).toContain('20');                // present days
  });

  test('wallet_balance reads the wallet data', () => {
    const ctx = makeCtx();
    const res = R.execute('wallet_balance', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('1000 EGP'); // total allocated
    expect(res.reply).toContain('500 EGP');  // remaining
  });

  test('leaves_balance returns the used/total breakdown', () => {
    const ctx = makeCtx();
    const res = R.execute('leaves_balance', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('annual');
    expect(res.reply).toContain('5');  // used
    expect(res.reply).toContain('21'); // total
  });

  test('backup_create calls createManualBackup', () => {
    const ctx = makeCtx();
    const res = R.execute('backup_create', {}, ctx, true);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'createManualBackup' || c.fn === 'snapshot')).toBe(true);
    expect(res.reply).toContain('نسخة');
  });

  test('reports_export_csv calls SPReports.exportCSV', () => {
    const ctx = makeCtx();
    const res = R.execute('reports_export_csv', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'exportCSV')).toBe(true);
  });

  test('reports_export_pdf calls SPPDF.exportReportRange', () => {
    const ctx = makeCtx();
    const res = R.execute('reports_export_pdf', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'exportReportRange')).toBe(true);
  });

  test('undo calls SPUndoRedo.undo when canUndo is true', () => {
    const ctx = makeCtx();
    const res = R.execute('undo', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'undo')).toBe(true);
  });

  test('undo returns graceful "nothing to undo" when canUndo is false', () => {
    const ctx = makeCtx({ SPUndoRedo: { canUndo: () => false, canRedo: () => false, undo: () => {}, redo: () => {} } });
    const res = R.execute('undo', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('مفيش');
  });

  test('lang_ar switches locale to ar', () => {
    const ctx = makeCtx();
    const res = R.execute('lang_ar', { target: 'ar' }, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'setLocale' && c.args[0] === 'ar')).toBe(true);
    expect(res.reply).toContain('العربية');
  });

  test('theme_toggle cycles the theme', () => {
    const ctx = makeCtx();
    const res = R.execute('theme_toggle', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'saveSettings' && c.args[0] && c.args[0].theme)).toBe(true);
  });

  test('open_settings_backup calls SPSettings.openSheetByName("backup")', () => {
    const ctx = makeCtx();
    const res = R.execute('open_settings_backup', {}, ctx, false);
    expect(res.ok).toBe(true);
    expect(ctx._calls.some(c => c.fn === 'openSheetByName' && c.args[0] === 'backup')).toBe(true);
  });

  test('law_search returns matched article text', () => {
    const ctx = makeCtx();
    const res = R.execute('law_search', { raw: 'المادة 41' }, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('المادة 41');
    expect(res.reply).toContain('نص المادة 41');
    expect(res.reply).toContain('قانون العمل المصري');
  });

  test('law_search returns graceful message when no match', () => {
    const ctx = makeCtx();
    const res = R.execute('law_search', { raw: 'كرسي طائر' }, ctx, false);
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('ملقتش');
  });

  test('explain_more returns a local-only explanation', () => {
    const ctx = makeCtx();
    const res = R.execute('explain_more', {}, ctx, false);
    expect(res.action).toBe('explain-more-local');
    expect(res.reply).toContain('محليًا');
  });

  test('unknown intent returns graceful unsupported reply', () => {
    const ctx = makeCtx();
    const res = R.execute('totally_bogus_intent', {}, ctx, false);
    expect(res.ok).toBe(false);
    expect(res.reply).toContain('مش قادر أفهم');
  });

  test('consequential intent without confirmation returns needsConfirm', () => {
    const ctx = makeCtx();
    const res = R.execute('attendance_checkin', {}, ctx, false /* confirmed=false */);
    expect(res.needsConfirm).toBe(true);
    expect(res.ok).toBe(false);
  });

  test('missing required module is reported gracefully, not thrown', () => {
    // ctx without SPWallet → wallet_balance should still return a reply, not throw
    const ctx = makeCtx({ SPWallet: undefined });
    expect(() => R.execute('wallet_balance', {}, ctx, false)).not.toThrow();
    const res = R.execute('wallet_balance', {}, ctx, false);
    expect(res.ok).toBe(false);
    expect(res.reply).toContain('محفظة');
  });
});

// ---------- handle() orchestrator ----------
describe('Mero assistant router — handle() orchestrator', () => {
  test('routes a navigation request end-to-end', () => {
    const calls = [];
    const ctx = {
      SPi18n: { getLocale: () => 'ar', formatCurrency: n => n + ' EGP', formatNumber: n => String(n) },
      SPApp: { goToTab: (t) => calls.push(t) }
    };
    const res = R.handle('افتح التقارير', ctx, {});
    expect(res.ok).toBe(true);
    expect(res.reply).toContain('فتحت');
    expect(calls).toContain('reports');
  });

  test('routes a law query without external-service context', () => {
    const ctx = {
      SPi18n: { getLocale: () => 'ar' },
      __LAW__: {
        preamble: [],
        books: [{ name: 'الكتاب الأول', articles: [{ num: 41, paras: ['نص المادة 41'] }] }]
      }
    };
    const res = R.handle('المادة 41', ctx, {});
    expect(res.ok).toBe(true);
  });

  test('routes explain-more to a local-only response', () => {
    const res = R.handle('اشرح اكتر', { SPi18n: { getLocale: () => 'ar' } }, {});
    expect(res.reply).toContain('محليًا');
  });

  test('routes an unknown message to a graceful fallback', () => {
    const res = R.handle('xyzzy floob', { SPi18n: { getLocale: () => 'ar' } }, {});
    expect(res.ok).toBe(false);
    expect(res.reply).toContain('مش قادر أفهم');
  });
});

// ---------- Pure helpers ----------
describe('Mero assistant router — pure helpers', () => {
  test('normalize() handles Arabic diacritics and alef variants', () => {
    expect(R.normalize('الإعدادات')).toBe(R.normalize('الاعدادات'));
    expect(R.normalize('المحفظة')).toBe(R.normalize('المحفظه'));
  });

  test('extractDate() parses "12 يناير"', () => {
    const d = R.extractDate('افتح يوم 12 يناير');
    expect(d).toMatch(/^\d{4}-01-12$/);
  });

  test('extractDate() parses ISO and "today/yesterday/tomorrow"', () => {
    expect(R.extractDate('2025-06-15')).toBe('2025-06-15');
    expect(R.extractDate('اليوم')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('extractNumber() pulls the first numeric token', () => {
    expect(R.extractNumber('add transaction 50')).toBe(50);
    expect(R.extractNumber('ضيف معامله 12.5 جنيه')).toBe(12.5);
    expect(R.extractNumber('no number here')).toBe(null);
  });
});
