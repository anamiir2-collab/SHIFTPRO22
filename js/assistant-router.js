/* ============================================================
   ShiftPro — NOVA Assistant Command Router
   ----------------------------------------------------------------
   Purpose:
     Maps natural-language requests (Egyptian Arabic, MSA, English)
     to REAL application capabilities exposed by the SP* modules,
     and executes them through existing public functions — never
     through eval, dynamic JS, or unsafe DOM manipulation.

   Design:
     - `detectIntent(message, ctx)` — PURE function. Returns an
       intent descriptor `{ kind, intent, params, needsConfirm,
       missing }` without touching the DOM. Safe to unit-test in
       Jest with zero mocking.
     - `execute(intent, ctx)` — calls real SP* module functions via
       the injected `ctx` (defaults to `window`). Always wrapped in
       try/catch; never throws to the caller. Returns
       `{ reply, ok, action }`.
     - `handle(message, ctx)` — orchestrator that calls detectIntent
       then execute and returns the final user-facing reply.

   Guarantees:
     - Consequential operations (delete, restore, financial changes)
       set `needsConfirm: true` — the UI layer must call
       `SPUtils.confirmDialog` (or equivalent) before invoking.
     - Missing parameters set `missing: ['date']` etc. — the UI
       layer should ask the user to clarify.
     - If an action's required module is unavailable, returns a
       graceful localized "feature unavailable" reply, never an
       exception.
     - Never fabricates data. If storage is empty, replies say so.
     - Never bypasses existing validation. Uses the same SP*
       entry points the UI uses.

   Exposed on `window.SPAssistantRouter`.
   ============================================================ */
(function (global) {
  'use strict';

  // ---------- i18n helpers (mirror ai-assistant.js for portability) ----------
  function locale(ctx) {
    return (ctx && ctx.SPi18n && ctx.SPi18n.getLocale) ? ctx.SPi18n.getLocale() : 'ar';
  }
  function isAr(ctx) { return locale(ctx) !== 'en'; }
  function tr(ctx, ar, en) { return isAr(ctx) ? ar : en; }

  // ---------- Arabic normalization ----------
  function normalize(s) {
    return String(s || '')
      .toLocaleLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel + tatweel
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); }) // arabic-indic digits → latin
      .trim();
  }

  // ---------- Number / date / time extraction ----------
  function extractNumber(text) {
    const m = String(text).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  // Matches Arabic or Latin month names + day numbers; returns ISO 'YYYY-MM-DD' or null.
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','ابريل','مايو','يونيو','يوليو','يوليه','أغسطس','اغسطس','سبتمبر','أكتوبر','اكتوبر','نوفمبر','ديسمبر'];
  const MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  function extractDate(text) {
    if (!text) return null;
    const s = String(text);
    // ISO first
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
    // "اليوم" / "today"  (no \b — JS word boundaries are ASCII-only)
    if (/(اليوم|today|النهارده|نصاري)/.test(s)) return todayStr();
    // "امبارح" / "yesterday"
    if (/(امبارح|امس|yesterday)/.test(s)) return todayStr(-1);
    // "بكره" / "tomorrow"
    if (/(بكره|غدا|tomorrow)/.test(s)) return todayStr(1);
    // "12 يناير" / "12 January" / "January 12"
    const lower = s.toLocaleLowerCase();
    let found = -1, day = null;
    for (let i = 0; i < MONTHS_AR.length; i++) {
      if (lower.includes(MONTHS_AR[i])) { found = i % 12; break; }
    }
    if (found < 0) {
      for (let i = 0; i < MONTHS_EN.length; i++) {
        if (lower.includes(MONTHS_EN[i])) { found = i; break; }
      }
    }
    if (found >= 0) {
      const dm = s.match(/(?:\D|^)(\d{1,2})(?:\D)/);
      if (dm) day = Number(dm[1]);
      const ym = s.match(/(\d{4})/);
      const year = ym ? Number(ym[1]) : new Date().getFullYear();
      if (day >= 1 && day <= 31) {
        return year + '-' + pad2(found + 1) + '-' + pad2(day);
      }
    }
    return null;
  }
  function extractTime(text) {
    if (!text) return null;
    const m = String(text).match(/\b(\d{1,2}):(\d{2})\b/);
    if (m) return pad2(m[1]) + ':' + m[2];
    // "الساعة 8" / "at 8"
    const m2 = String(text).match(/(?:الساعة|الساعه|ساعة|ساعه|at|@)\s*(\d{1,2})(?::(\d{2}))?/);
    if (m2) return pad2(m2[1]) + ':' + pad2(m2[2] || '0');
    return null;
  }
  function pad2(n) { n = Number(n); return String(n).padStart(2, '0'); }
  function todayStr(offset) {
    const d = new Date();
    if (offset) d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ---------- Intent keyword tables ----------
  // Each entry: { intent, words: [normalize-form strings], confirm?: true, missing?: [...] }
  const INTENTS = [
    // --- Greetings & small talk ---
    { intent: 'greeting', words: ['مرحبا','مرحبتين','اهلا','السلام عليكم','هاي','hi','hello','hey','صباح الخير','مساء الخير'] },
    { intent: 'thanks', words: ['شكرا','شكراً','متشكر','تسلم','thanks','thank you','thx'] },
    { intent: 'help', words: ['مساعده','ماتقدرتعمل','ماذا تستطيع','ماذا يمكنك','ايه اللي تقدر تعمله','help','what can you do','capabilities'] },

    // --- Navigation ---
    // Note: do NOT include "افتح الورديات" in nav_calendar — that routes to
    // the Shift Manager settings sheet (open_settings_shifts). For the
    // calendar view, users say "افتح التقويم" or "افتح الجدول".
    { intent: 'nav_dashboard', words: ['افتح الرئيسيه','افتح الرئيسية','روح الرئيسيه','روح على الرئيسيه','روح علي الرئيسيه','افتح الداشبورد','الصفحه الرئيسيه','open dashboard','go home','go to dashboard','open home'] },
    { intent: 'nav_calendar', words: ['افتح التقويم','روح التقويم','روح على التقويم','افتح الجدول','افتح تقويم الورديات','افتح جدول الورديات','open calendar','go to calendar'] },
    { intent: 'nav_salary', words: ['افتح الراتب','افتح الرواتب','روح الراتب','open salary','go to salary','open payroll'] },
    { intent: 'nav_reports', words: ['افتح التقارير','روح التقارير','افتح التقرير','open reports','go to reports','open report'] },
    { intent: 'nav_wallet', words: ['افتح المحفظه','افتح المحفظة','روح المحفظه','افتح المحافظ','open wallet','go to wallet','open wallets'] },
    { intent: 'nav_law', words: ['افتح القانون','روح القانون','افتح قانون العمل','open law','go to law','open labor law'] },
    { intent: 'nav_settings', words: ['افتح الاعدادات','افتح الإعدادات','افتح الاعدادت','روح الاعدادات','افتح المزيد','open settings','go to settings','open more','open profile'] },

    // --- Attendance ---
    { intent: 'attendance_checkin', words: ['سجل حضور','سجل الحضور','تسجيل حضور','check in','check-in','clock in','punch in'], confirm: true },
    { intent: 'attendance_checkout', words: ['سجل انصراف','سجل الانصراف','تسجيل انصراف','انصرف','check out','check-out','clock out','punch out'], confirm: true },
    { intent: 'attendance_open_day', words: ['افتح تفاصيل يوم','اعرض تفاصيل يوم','افتح يوم','روح ليوم','open day','show day','day details'] },

    // --- Salary ---
    { intent: 'salary_compute', words: ['احسب راتبي','حساب الراتب','احسب الراتب','راتبي الشهر','راتب الشهر','حساب الراتب الشهر','compute salary','calculate salary','my salary','this month salary'] },
    { intent: 'salary_overtime', words: ['ساعات الاوف تايم','ساعات الاوت تايم','الاور تايم','الاوفر تايم','ساعات الاضافي','اضافي','overtime','extra hours','over time'] },
    { intent: 'salary_deductions', words: ['الخصومات','الخصومات الشهر','ايه الخصومات','deductions','salary deductions'] },
    { intent: 'salary_summary', words: ['ملخص الراتب','ملخص راتبي','salary summary','my salary summary'] },

    // --- Wallet ---
    { intent: 'wallet_balance', words: ['رصيد المحفظه','رصيد المحفظة','ايه رصيد','المحفظه فيها كام','محفظتي','wallet balance','my balance','wallet total'] },
    { intent: 'wallet_list', words: ['اعرض المحافظ','قائمة المحافظ','كل المحافظ','list wallets','show wallets','my wallets'] },
    { intent: 'wallet_open', words: ['افتح تفاصيل المحفظه','افتح محفظه','open wallet details','wallet details'] },
    { intent: 'wallet_add_tx', words: ['ضيف معامله','ضيف معاملة','اضف معامله','اضافة معامله','سجل معامله','add transaction','add expense','new transaction'], confirm: true },
    { intent: 'wallet_transfer', words: ['حول من','حول فلوس','تحويل بين المحافظ','transfer money','transfer between wallets','move money'], confirm: true },

    // --- Leaves ---
    { intent: 'leaves_balance', words: ['رصيد الاجازات','رصيد الإجازات','كام اجازه','اجازاتي','leave balance','my leaves','annual leave balance'] },
    { intent: 'leaves_list', words: ['طلبات الاجازه','طلبات الإجازة','قائمة الاجازات','leave requests','my leave requests','list leaves'] },

    // --- Backup ---
    { intent: 'backup_create', words: ['اعمل نسخه احتياطيه','اعمل نسخة احتياطية','نسخه احتياطيه','نسخة احتياطية','backup','create backup','make backup'], confirm: true },
    { intent: 'backup_export_json', words: ['تصدير json','تصدير جيسون','export json','download json'] },
    { intent: 'backup_export_csv', words: ['تصدير csv','تصدير سي اف في','export csv','download csv'] },

    // --- Reports / Exports ---
    { intent: 'reports_export_csv', words: ['تقرير csv','تقرير حضور csv','تقرير سي اف في','report csv','attendance report csv'] },
    { intent: 'reports_export_xlsx', words: ['تقرير xlsx','تقرير اكسل','تقرير اكسيل','report xlsx','excel report'] },
    { intent: 'reports_export_pdf', words: ['تقرير pdf','تقرير بي دي اف','اطبع تقرير','report pdf','pdf report','export pdf'] },

    // --- Undo / Redo ---
    { intent: 'undo', words: ['تراجع','تراجع عن الاخير','undo','rollback'] },
    { intent: 'redo', words: ['اعمل redo','اعاده','اعملها تاني','redo','repeat'] },

    // --- Language & Theme ---
    { intent: 'lang_ar', words: ['غير اللغه للعربي','غير اللغة للعربية','عربي','العربيه','switch to arabic','arabic please','arabic'] },
    { intent: 'lang_en', words: ['غير اللغه للانجليزي','غير اللغة للإنجليزية','انجليزي','إنجليزي','switch to english','english please','english'] },
    { intent: 'theme_toggle', words: ['غير الثيم','غير المظهر','الوضع الليلي','الوضع النهاري','toggle theme','switch theme','dark mode','light mode'] },
    { intent: 'open_appearance', words: ['افتح اعدادات المظهر','افتح إعدادات المظهر','افتح الثيم','open appearance','open theme settings','appearance settings'] },

    // --- Settings sheets ---
    { intent: 'open_settings_general', words: ['افتح الاعدادات العامه','افتح الإعدادات العامة','open general settings','general settings'] },
    { intent: 'open_settings_salary', words: ['افتح اعدادات الراتب','افتح إعدادات الراتب','open salary settings','salary settings'] },
    { intent: 'open_settings_shifts', words: ['افتح ادارة الورديات','افتح الورديات','open shifts manager','shifts settings','manage shifts'] },
    { intent: 'open_settings_leave', words: ['افتح الاجازات','افتح الإجازات','open leave settings','leave settings'] },
    { intent: 'open_settings_datetime', words: ['افتح اعدادات التاريخ والوقت','افتح إعدادات التاريخ والوقت','open date time settings','date time settings'] },
    { intent: 'open_settings_notifications', words: ['افتح الاشعارات','افتح إعدادات الاشعارات','open notifications','notification settings'] },
    { intent: 'open_settings_control', words: ['افتح الاداره','افتح التحكم','open control','control panel','app control'] },
    { intent: 'open_settings_stats', words: ['افتح الاحصائيات','افتح الاحصايات','open stats','statistics'] },
    { intent: 'open_settings_backup', words: ['افحص النسخ الاحتياطيه','افتح النسخ الاحتياطي','افتح النسخه الاحتياطيه','open backup settings','backup settings'] },
    { intent: 'open_settings_about', words: ['افتح عن التطبيق','افتح عن الشغل','open about','about app','about shiftpro'] },

    // --- Law (RAG over window.__LAW__) ---
    { intent: 'law_search', words: ['قانون العمل','ماده','مواد القانون','الماده','المادة','فصل تعسفي','عقد العمل','ساعات العمل','فتره الراحه','الراحه الاسبوعيه','الاجر','الاجور','الحد الادني','مكافاه نهايه الخدمه','التامينات','تعويض','تشغيل العمال','اجازه','الاجازه','المرضي','المرضيه','annual leave','labor law','labour law','employment contract','working hours','severance','dismissal','resignation','wages','article'] },

    // --- Explain / simplify (route to API fallback) ---
    { intent: 'explain_more', words: ['اشرح اكتر','بسطها اكتر','بسطها لي','بسيطه اكتر','افهمها اكتر','وضحلي','وضح لي','شرح اكتر','تفاصيل اكتر','explain more','simplify','break it down','explain it','more detail','clarify','what does it mean'] },
  ];

  // ---------- Intent detection (PURE) ----------
  // Returns: { kind, intent, raw, params, needsConfirm, missing }
  //   - kind: 'local' | 'api' | 'unsupported'
  //   - intent: string (matches an entry in INTENTS, or 'law_search' fallback, or 'unknown')
  //   - params: extracted parameters (date, time, amount, target, etc.)
  //   - needsConfirm: true for consequential ops (UI must confirm first)
  //   - missing: array of param names still required
  function detectIntent(message, ctx) {
    ctx = ctx || {};
    const m = normalize(message);
    if (!m) return { kind: 'unsupported', intent: 'empty', raw: message, params: {}, needsConfirm: false, missing: [] };

    // Direct keyword match — first wins (INTENTS order is meaningful).
    let matched = null;
    for (const entry of INTENTS) {
      if (entry.words.some(w => m.includes(normalize(w)))) {
        matched = entry;
        break;
      }
    }

    // Special handling: if "open day details" intent matched, extract date.
    if (matched && matched.intent === 'attendance_open_day') {
      const date = extractDate(message);
      return {
        kind: 'local',
        intent: 'attendance_open_day',
        raw: message,
        params: { date },
        needsConfirm: false,
        missing: date ? [] : ['date']
      };
    }

    // Special handling: wallet add transaction — extract amount + (optional) wallet name.
    if (matched && matched.intent === 'wallet_add_tx') {
      const amount = extractNumber(message);
      return {
        kind: 'local',
        intent: 'wallet_add_tx',
        raw: message,
        params: { amount },
        needsConfirm: true,
        missing: amount == null ? ['amount'] : []
      };
    }

    // Special handling: language switching with explicit target.
    if (matched && (matched.intent === 'lang_ar' || matched.intent === 'lang_en')) {
      return {
        kind: 'local',
        intent: matched.intent,
        raw: message,
        params: { target: matched.intent === 'lang_ar' ? 'ar' : 'en' },
        needsConfirm: false,
        missing: []
      };
    }

    // Special handling: "explain more" routes to API.
    if (matched && matched.intent === 'explain_more') {
      return {
        kind: 'api',
        intent: 'explain_more',
        raw: message,
        params: { original: message },
        needsConfirm: false,
        missing: []
      };
    }

    if (matched) {
      return {
        kind: matched.intent === 'law_search' ? 'law' : 'local',
        intent: matched.intent,
        raw: message,
        params: {},
        needsConfirm: !!matched.confirm,
        missing: []
      };
    }

    // Law fallback: if message contains strong legal terms but didn't match a specific intent.
    const lawFallback = /\b(قانون|ماده|مادة|اجازه|اجازة|عقد|استقاله|فصل|راتب|اجر|working|leave|article|law)\b/.test(m);
    if (lawFallback) {
      return { kind: 'law', intent: 'law_search', raw: message, params: {}, needsConfirm: false, missing: [] };
    }

    return { kind: 'unsupported', intent: 'unknown', raw: message, params: {}, needsConfirm: false, missing: [] };
  }

  // ---------- Adapter helpers (call real SP* functions safely) ----------
  function safeCall(ctx, fnPath, ...args) {
    // fnPath is a dotted string like 'SPApp.goToTab'
    const parts = fnPath.split('.');
    let obj = ctx;
    for (const p of parts) {
      if (obj == null) return { ok: false, error: 'missing:' + fnPath, value: undefined };
      obj = obj[p];
    }
    if (typeof obj !== 'function') return { ok: false, error: 'not-a-function:' + fnPath, value: undefined };
    try {
      const value = obj.apply(null, args);
      return { ok: true, error: null, value };
    } catch (e) {
      return { ok: false, error: e && e.message || 'runtime', value: undefined };
    }
  }

  function fmtCurrency(ctx, n) {
    if (n == null || isNaN(n)) n = 0;
    if (ctx && ctx.SPi18n && typeof ctx.SPi18n.formatCurrency === 'function') {
      return ctx.SPi18n.formatCurrency(n);
    }
    return String(n) + ' EGP';
  }
  function fmtNum(ctx, n, dec) {
    if (n == null || isNaN(n)) n = 0;
    if (ctx && ctx.SPi18n && typeof ctx.SPi18n.formatNumber === 'function') {
      return ctx.SPi18n.formatNumber(n, dec);
    }
    return String(n);
  }
  function fmtDateLabel(ctx, dstr) {
    if (!dstr) return '';
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dstr);
    if (!m) return dstr;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (ctx && ctx.SPi18n && typeof ctx.SPi18n.formatDate === 'function') {
      return ctx.SPi18n.formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return dstr;
  }
  function workerName(ctx) {
    const doc = (typeof document !== 'undefined') ? document : null;
    const el = doc && (doc.getElementById('workerName') || doc.getElementById('heroName'));
    const name = (el && el.textContent || '').trim();
    if (!name || name === '—') return isAr(ctx) ? 'صديقي' : 'there';
    return name;
  }

  // ---------- Executors (one per intent) ----------
  // Each returns { reply: string, ok: boolean, action?: string }

  function execNav(ctx, tab) {
    const res = safeCall(ctx, 'SPApp.goToTab', tab);
    if (!res.ok) return { reply: tr(ctx, 'تعذّر فتح القسم — الوحدة غير محملة.', 'Could not open the section — the module is not loaded.'), ok: false };
    return { reply: tr(ctx, 'تمام يا ' + workerName(ctx) + '، فتحت لك القسم.', 'Done, ' + workerName(ctx) + '. I opened the section.'), ok: true, action: 'nav:' + tab };
  }

  function execCheckIn(ctx) {
    const doc = (typeof document !== 'undefined') ? document : null;
    const b = doc && doc.getElementById('checkinBtn');
    if (!b || b.disabled || b.hidden) {
      return { reply: tr(ctx, 'زر تسجيل الحضور مش متاح حاليًا — يمكن يكون تم تسجيل حضورك بالفعل.', 'Check-in is not available right now — you may have already checked in.'), ok: false };
    }
    b.click();
    return { reply: tr(ctx, 'نفّذت طلب تسجيل الحضور. راجع بطاقة اليوم للتأكد.', 'I triggered check-in. Please verify today\'s card.'), ok: true, action: 'attendance:checkin' };
  }

  function execCheckOut(ctx) {
    const doc = (typeof document !== 'undefined') ? document : null;
    const b = doc && doc.getElementById('checkoutBtn');
    if (!b || b.disabled || b.hidden) {
      return { reply: tr(ctx, 'زر تسجيل الانصراف مش متاح حاليًا — لازم تسجل حضور الأول.', 'Check-out is not available right now — check in first.'), ok: false };
    }
    b.click();
    return { reply: tr(ctx, 'نفذت طلب تسجيل الانصراف. راجع الساعات المسجلة.', 'I triggered check-out. Please verify the recorded hours.'), ok: true, action: 'attendance:checkout' };
  }

  function execOpenDay(ctx, dstr) {
    if (!dstr) return { reply: tr(ctx, 'حدد التاريخ — مثلاً: «افتح تفاصيل يوم 12 يناير».', 'Please specify a date — e.g., "open day 12 January".'), ok: false };
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dstr);
    if (!m) return { reply: tr(ctx, 'مش قادر أقرا التاريخ ده.', 'I could not parse that date.'), ok: false };
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Open the day sheet via SPAttendance.openDaySheet
    if (ctx.SPApp) ctx.SPApp.goToTab && ctx.SPApp.goToTab('calendar');
    const res = safeCall(ctx, 'SPAttendance.openDaySheet', date);
    if (!res.ok) return { reply: tr(ctx, 'تعذّر فتح تفاصيل اليوم.', 'Could not open day details.'), ok: false };
    return { reply: tr(ctx, 'فتحت لك تفاصيل يوم ' + fmtDateLabel(ctx, dstr) + '.', 'I opened details for ' + fmtDateLabel(ctx, dstr) + '.'), ok: true, action: 'day:open:' + dstr };
  }

  function execSalaryCompute(ctx) {
    const cal = ctx.SPCalendar, sal = ctx.SPSalary;
    if (!cal || !sal) return { reply: tr(ctx, 'وحدة الراتب مش محملة.', 'Salary module is not loaded.'), ok: false };
    const today = new Date();
    let period;
    try { period = cal.getPayPeriod(today); } catch (_) {
      return { reply: tr(ctx, 'تعذّر حساب فترة الدفع.', 'Could not determine pay period.'), ok: false };
    }
    let r;
    try { r = sal.computeSalary(period.start, period.end); } catch (e) {
      return { reply: tr(ctx, 'حصل خطأ أثناء حساب الراتب.', 'An error occurred while computing salary.'), ok: false };
    }
    const lines = [
      (isAr(ctx) ? 'الفترة: ' : 'Period: ') + fmtDateLabel(ctx, ctx.SPUtils && ctx.SPUtils.fmtDate ? ctx.SPUtils.fmtDate(period.start) : '') + ' → ' + fmtDateLabel(ctx, ctx.SPUtils && ctx.SPUtils.fmtDate ? ctx.SPUtils.fmtDate(period.end) : ''),
      (isAr(ctx) ? 'أيام الحضور: ' : 'Present: ') + (r.counts.A + r.counts.X) + '  •  ' + (isAr(ctx) ? 'الإجازات: ' : 'Leaves: ') + r.counts.L + '  •  ' + (isAr(ctx) ? 'الغياب: ' : 'Absent: ') + r.counts.B,
      (isAr(ctx) ? 'إجمالي الساعات: ' : 'Total hours: ') + fmtNum(ctx, r.totalHours, 1) + ' (' + (isAr(ctx) ? 'أساسي ' : 'base ') + fmtNum(ctx, r.baseHours, 1) + ' + ' + (isAr(ctx) ? 'أوفرتايم ' : 'overtime ') + fmtNum(ctx, r.overtimeHours, 1) + ')',
      (isAr(ctx) ? 'الراتب الأساسي: ' : 'Base salary: ') + fmtCurrency(ctx, r.baseSalary),
      (isAr(ctx) ? 'البدلات/المكافآت: ' : 'Bonus/allowance: ') + fmtCurrency(ctx, r.bonus + r.allowance),
      (isAr(ctx) ? 'الخصومات: ' : 'Deductions: ') + fmtCurrency(ctx, r.totalDeductions) + ' (' + (isAr(ctx) ? 'غياب ' : 'absence ') + fmtCurrency(ctx, r.absenceDeduction) + ' + ' + (isAr(ctx) ? 'تأخير ' : 'late ') + fmtCurrency(ctx, r.lateDeduction) + ' + ' + (isAr(ctx) ? 'سلف ' : 'advance ') + fmtCurrency(ctx, r.advance) + ')',
      (isAr(ctx) ? 'صافي الراتب المستحق: ' : 'Net salary due: ') + fmtCurrency(ctx, r.netSalary)
    ];
    return { reply: lines.join('\n'), ok: true, action: 'salary:compute' };
  }

  function execSalaryOvertime(ctx) {
    const cal = ctx.SPCalendar, sal = ctx.SPSalary;
    if (!cal || !sal) return { reply: tr(ctx, 'وحدة الراتب مش محملة.', 'Salary module is not loaded.'), ok: false };
    const today = new Date();
    let period, r;
    try { period = cal.getPayPeriod(today); r = sal.computeSalary(period.start, period.end); } catch (_) {
      return { reply: tr(ctx, 'تعذّر حساب الأوفرتايم.', 'Could not compute overtime.'), ok: false };
    }
    const lines = [
      (isAr(ctx) ? 'ساعات الأوفرتايم: ' : 'Overtime hours: ') + fmtNum(ctx, r.overtimeHours, 1),
      (isAr(ctx) ? 'بمعدل: ' : 'At rate: ') + fmtCurrency(ctx, sal.getOvertimeHourlyRate ? sal.getOvertimeHourlyRate() : 0) + (isAr(ctx) ? '/ساعة' : '/hr'),
      (isAr(ctx) ? 'القيمة: ' : 'Value: ') + fmtCurrency(ctx, r.overtimeValue)
    ];
    return { reply: lines.join('\n'), ok: true };
  }

  function execSalaryDeductions(ctx) {
    const cal = ctx.SPCalendar, sal = ctx.SPSalary;
    if (!cal || !sal) return { reply: tr(ctx, 'وحدة الراتب مش محملة.', 'Salary module is not loaded.'), ok: false };
    const today = new Date();
    let period, r;
    try { period = cal.getPayPeriod(today); r = sal.computeSalary(period.start, period.end); } catch (_) {
      return { reply: tr(ctx, 'تعذّر حساب الخصومات.', 'Could not compute deductions.'), ok: false };
    }
    const lines = [
      (isAr(ctx) ? 'إجمالي الخصومات: ' : 'Total deductions: ') + fmtCurrency(ctx, r.totalDeductions),
      (isAr(ctx) ? 'خصم الغياب: ' : 'Absence deduction: ') + fmtCurrency(ctx, r.absenceDeduction),
      (isAr(ctx) ? 'خصم التأخير: ' : 'Late deduction: ') + fmtCurrency(ctx, r.lateDeduction),
      (isAr(ctx) ? 'السلف: ' : 'Advances: ') + fmtCurrency(ctx, r.advance),
      (isAr(ctx) ? 'خصومات إدارية: ' : 'Other deductions: ') + fmtCurrency(ctx, r.deduction)
    ];
    return { reply: lines.join('\n'), ok: true };
  }

  function execWalletBalance(ctx) {
    const w = ctx.SPWallet;
    if (!w) return { reply: tr(ctx, 'وحدة المحفظة مش محملة.', 'Wallet module is not loaded.'), ok: false };
    let data;
    try { data = w.getData(); } catch (_) { return { reply: tr(ctx, 'تعذّر قراءة بيانات المحفظة.', 'Could not read wallet data.'), ok: false }; }
    if (!data || !Array.isArray(data.wallets) || data.wallets.length === 0) {
      return { reply: tr(ctx, 'لا توجد محافظ بعد. افتح قسم المحفظة وأضف واحدة.', 'No wallets yet. Open the wallet section and add one.'), ok: true };
    }
    const totalAllocated = w.getTotalAllocated ? w.getTotalAllocated() : 0;
    const totalRemaining = w.getTotalRemaining ? w.getTotalRemaining() : 0;
    const totalExpenses = w.getTotalExpenses ? w.getTotalExpenses() : 0;
    const totalIncome = w.getTotalIncome ? w.getTotalIncome() : 0;
    const lines = [
      (isAr(ctx) ? 'عدد المحافظ: ' : 'Wallets: ') + data.wallets.length,
      (isAr(ctx) ? 'إجمالي المخصص: ' : 'Total allocated: ') + fmtCurrency(ctx, totalAllocated),
      (isAr(ctx) ? 'المتبقي: ' : 'Remaining: ') + fmtCurrency(ctx, totalRemaining),
      (isAr(ctx) ? 'المصروفات (الفترة الحالية): ' : 'Expenses (current period): ') + fmtCurrency(ctx, totalExpenses),
      (isAr(ctx) ? 'الدخل (الفترة الحالية): ' : 'Income (current period): ') + fmtCurrency(ctx, totalIncome)
    ];
    return { reply: lines.join('\n'), ok: true };
  }

  function execWalletList(ctx) {
    const w = ctx.SPWallet;
    if (!w) return { reply: tr(ctx, 'وحدة المحفظة مش محملة.', 'Wallet module is not loaded.'), ok: false };
    let data;
    try { data = w.getData(); } catch (_) { return { reply: tr(ctx, 'تعذّر قراءة بيانات المحفظة.', 'Could not read wallet data.'), ok: false }; }
    if (!data || !data.wallets || data.wallets.length === 0) {
      return { reply: tr(ctx, 'لا توجد محافظ بعد.', 'No wallets yet.'), ok: true };
    }
    const lines = data.wallets.map(function (wl) {
      const stats = w.walletStats ? w.walletStats(wl, w.currentPeriodKey ? w.currentPeriodKey() : null) : { balance: wl.amount };
      return '• ' + (wl.name || 'بدون اسم') + ' — ' + fmtCurrency(ctx, wl.amount) + (stats && stats.expenses != null ? '  (' + (isAr(ctx) ? 'مصروف ' : 'spent ') + fmtCurrency(ctx, stats.expenses) + ')' : '');
    });
    return { reply: (isAr(ctx) ? 'محافظك:\n' : 'Your wallets:\n') + lines.join('\n'), ok: true };
  }

  function execWalletOpen(ctx) {
    if (ctx.SPApp) ctx.SPApp.goToTab && ctx.SPApp.goToTab('wallet');
    return { reply: tr(ctx, 'فتحت لك قسم المحفظة.', 'I opened the wallet section.'), ok: true, action: 'nav:wallet' };
  }

  function execWalletAddTx(ctx, params) {
    if (params && params.amount == null) {
      return { reply: tr(ctx, 'حدد مبلغ المعاملة — مثلاً: «ضيف معاملة 50 جنيه».', 'Please specify an amount — e.g., "add transaction 50 EGP".'), ok: false };
    }
    return { reply: tr(ctx, 'افتح المحفظة وادخل تفاصيل المعاملة، أو استخدم زر «إضافة معاملة» داخل المحفظة. المبلغ المقترح: ' + fmtCurrency(ctx, params.amount) + '.', 'Open the wallet and enter transaction details, or use the "Add transaction" button. Suggested amount: ' + fmtCurrency(ctx, params.amount) + '.'), ok: true, action: 'wallet:add-tx' };
  }

  function execLeavesBalance(ctx) {
    const l = ctx.SPLeaves;
    if (!l) return { reply: tr(ctx, 'وحدة الإجازات مش محملة.', 'Leaves module is not loaded.'), ok: false };
    let bal;
    try { bal = l.calculateBalances ? l.calculateBalances(new Date().getFullYear()) : l.getDefaultBalances(); } catch (_) {
      return { reply: tr(ctx, 'تعذّر حساب أرصدة الإجازات.', 'Could not compute leave balances.'), ok: false };
    }
    if (!bal) return { reply: tr(ctx, 'لا توجد بيانات إجازات.', 'No leave data.'), ok: true };
    const lines = Object.keys(bal).map(function (k) {
      const v = bal[k] || {};
      const used = v.used || 0, total = v.total || 0;
      const remaining = Math.max(0, total - used);
      return '• ' + k + ': ' + (isAr(ctx) ? 'استخدمت ' : 'used ') + used + ' من ' + total + ' (' + (isAr(ctx) ? 'متبقي ' : 'left ') + remaining + ')';
    });
    return { reply: (isAr(ctx) ? 'أرصدة الإجازات:\n' : 'Leave balances:\n') + lines.join('\n'), ok: true };
  }

  function execLeavesList(ctx) {
    const l = ctx.SPLeaves;
    if (!l) return { reply: tr(ctx, 'وحدة الإجازات مش محملة.', 'Leaves module is not loaded.'), ok: false };
    let reqs;
    try { reqs = l.getRequests ? l.getRequests() : []; } catch (_) { reqs = []; }
    if (!reqs || !reqs.length) {
      return { reply: tr(ctx, 'لا توجد طلبات إجازة مسجلة.', 'No leave requests recorded.'), ok: true };
    }
    const lines = reqs.slice(0, 10).map(function (r) {
      return '• ' + (r.fromDate || r.date || '?') + ' — ' + (r.toDate || r.fromDate || '?') + ' (' + (r.type || 'annual') + ', ' + (r.status || 'pending') + ')';
    });
    return { reply: (isAr(ctx) ? 'طلبات الإجازة:\n' : 'Leave requests:\n') + lines.join('\n') + (reqs.length > 10 ? '\n…' : ''), ok: true };
  }

  function execBackupCreate(ctx) {
    const b = ctx.SPBackup;
    if (!b) return { reply: tr(ctx, 'وحدة النسخ الاحتياطي مش محملة.', 'Backup module is not loaded.'), ok: false };
    let snap;
    try { snap = b.createManualBackup ? b.createManualBackup('assistant') : b.snapshot(); } catch (e) {
      return { reply: tr(ctx, 'تعذّر إنشاء نسخة احتياطية: ' + (e && e.message || ''), 'Could not create backup: ' + (e && e.message || '')), ok: false };
    }
    return { reply: tr(ctx, 'تم إنشاء نسخة احتياطية محلية بنجاح.', 'A local backup snapshot was created.'), ok: true, action: 'backup:create' };
  }

  function execBackupExportJSON(ctx) {
    const b = ctx.SPBackup;
    if (!b || !b.exportJSON) return { reply: tr(ctx, 'التصدير غير متاح حاليًا.', 'Export is not available right now.'), ok: false };
    try { b.exportJSON(); } catch (e) { return { reply: tr(ctx, 'تعذّر التصدير: ' + (e && e.message || ''), 'Export failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تم تنزيل نسخة JSON احتياطية.', 'A JSON backup was downloaded.'), ok: true, action: 'backup:export-json' };
  }

  function execBackupExportCSV(ctx) {
    const b = ctx.SPBackup;
    if (!b || !b.exportCSV) return { reply: tr(ctx, 'التصدير غير متاح حاليًا.', 'Export is not available right now.'), ok: false };
    try { b.exportCSV(); } catch (e) { return { reply: tr(ctx, 'تعذّر التصدير: ' + (e && e.message || ''), 'Export failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تم تنزيل تقرير الحضور CSV.', 'A CSV attendance report was downloaded.'), ok: true, action: 'backup:export-csv' };
  }

  function execReportsExportCSV(ctx) {
    const r = ctx.SPReports;
    if (!r || !r.exportCSV) return { reply: tr(ctx, 'التصدير غير متاح حاليًا.', 'Export is not available right now.'), ok: false };
    try { r.exportCSV(); } catch (e) { return { reply: tr(ctx, 'تعذّر التصدير: ' + (e && e.message || ''), 'Export failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تم تنزيل تقرير CSV.', 'A CSV report was downloaded.'), ok: true, action: 'reports:export-csv' };
  }

  function execReportsExportXLSX(ctx) {
    const r = ctx.SPReports;
    if (!r || !r.exportReportXLSX) return { reply: tr(ctx, 'التصدير غير متاح حاليًا.', 'Export is not available right now.'), ok: false };
    try { r.exportReportXLSX(); } catch (e) { return { reply: tr(ctx, 'تعذّر التصدير: ' + (e && e.message || ''), 'Export failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تم تنزيل تقرير Excel.', 'An XLSX report was downloaded.'), ok: true, action: 'reports:export-xlsx' };
  }

  function execReportsExportPDF(ctx) {
    const p = ctx.SPPDF;
    if (!p || !p.exportReportRange) return { reply: tr(ctx, 'تصدير PDF غير متاح — تأكد إن jsPDF محمّل.', 'PDF export is not available — make sure jsPDF is loaded.'), ok: false };
    const cal = ctx.SPCalendar, today = new Date();
    let period;
    try { period = cal.getPayPeriod(today); } catch (_) { period = { start: today, end: today }; }
    try {
      const sp = ctx.SPUtils;
      p.exportReportRange(sp && sp.fmtDate ? sp.fmtDate(period.start) : null, sp && sp.fmtDate ? sp.fmtDate(period.end) : null);
    } catch (e) {
      return { reply: tr(ctx, 'تعذّر تصدير PDF: ' + (e && e.message || ''), 'PDF export failed: ' + (e && e.message || '')), ok: false };
    }
    return { reply: tr(ctx, 'تم تنزيل تقرير PDF للفترة الحالية.', 'A PDF report for the current period was downloaded.'), ok: true, action: 'reports:export-pdf' };
  }

  function execUndo(ctx) {
    const u = ctx.SPUndoRedo;
    if (!u) return { reply: tr(ctx, 'التراجع مش متاح حاليًا.', 'Undo is not available right now.'), ok: false };
    if (u.canUndo && !u.canUndo()) return { reply: tr(ctx, 'مفيش إجراءات للتراجع عنها.', 'Nothing to undo.'), ok: true };
    try { u.undo(); } catch (e) { return { reply: tr(ctx, 'تعذّر التراجع: ' + (e && e.message || ''), 'Undo failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تم التراجع عن آخر إجراء.', 'Undid the last action.'), ok: true, action: 'undo' };
  }

  function execRedo(ctx) {
    const u = ctx.SPUndoRedo;
    if (!u) return { reply: tr(ctx, 'الإعادة مش متاحة حاليًا.', 'Redo is not available right now.'), ok: false };
    if (u.canRedo && !u.canRedo()) return { reply: tr(ctx, 'مفيش إجراءات لإعادتها.', 'Nothing to redo.'), ok: true };
    try { u.redo(); } catch (e) { return { reply: tr(ctx, 'تعذّرت الإعادة: ' + (e && e.message || ''), 'Redo failed: ' + (e && e.message || '')), ok: false }; }
    return { reply: tr(ctx, 'تمت إعادة آخر إجراء.', 'Redid the last action.'), ok: true, action: 'redo' };
  }

  function execLang(ctx, target) {
    const i = ctx.SPi18n;
    if (!i || !i.setLocale) return { reply: tr(ctx, 'تعذّر تبديل اللغة.', 'Could not switch language.'), ok: false };
    try { i.setLocale(target); } catch (e) { return { reply: tr(ctx, 'تعذّر تبديل اللغة.', 'Could not switch language.'), ok: false }; }
    // After switching, reply in the NEW locale.
    if (target === 'ar') return { reply: 'تم تغيير اللغة إلى العربية.', ok: true, action: 'lang:ar' };
    return { reply: 'Language switched to English.', ok: true, action: 'lang:en' };
  }

  function execThemeToggle(ctx) {
    // Use SPUX.applyTheme / restoreTheme if present, else fall back to settings.theme cycle.
    const s = ctx.SPStorage;
    if (!s) return { reply: tr(ctx, 'تعذّر تبديل الثيم.', 'Could not toggle theme.'), ok: false };
    try {
      const cur = s.getSettings();
      const next = cur.theme === 'dark' ? 'light' : (cur.theme === 'light' ? 'auto' : 'dark');
      s.saveSettings({ theme: next });
      if (ctx.SPSettings && typeof ctx.SPSettings.applyTheme === 'function') ctx.SPSettings.applyTheme();
    } catch (e) { return { reply: tr(ctx, 'تعذّر تبديل الثيم.', 'Could not toggle theme.'), ok: false }; }
    return { reply: tr(ctx, 'تم تبديل الثيم.', 'Theme toggled.'), ok: true, action: 'theme:toggle' };
  }

  function execOpenSheet(ctx, name) {
    const s = ctx.SPSettings;
    if (!s || !s.openSheetByName) return { reply: tr(ctx, 'تعذّر فتح الإعدادات.', 'Could not open settings.'), ok: false };
    try { s.openSheetByName(name); } catch (e) { return { reply: tr(ctx, 'تعذّر فتح الإعدادات.', 'Could not open settings.'), ok: false }; }
    return { reply: tr(ctx, 'فتحت لك الإعدادات المطلوبة.', 'I opened the requested settings.'), ok: true, action: 'sheet:' + name };
  }

  // ---------- Law RAG (searches window.__LAW__) ----------
  function execLawSearch(ctx, message) {
    const law = ctx.__LAW__ || (typeof global !== 'undefined' && global.__LAW__) || null;
    if (!law || !Array.isArray(law.books)) {
      return { reply: tr(ctx, 'قانون العمل مش محمل. افتح تبويب القانون مرة واحدة لتحميله.', 'Labor law data is not loaded. Open the Law tab once to load it.'), ok: false };
    }
    const m = normalize(message);
    const records = [];
    (law.preamble || []).forEach(function (item) {
      const body = Array.isArray(item.text) ? item.text.join(' ') : String(item.text || '');
      records.push({ title: item.title || 'مواد الإصدار', body: body, kind: 'preamble' });
    });
    function addArticles(items, bookName, chapterName, sectionName) {
      (items || []).forEach(function (item) {
        const paras = item.paras || item.text || item.content || [];
        const body = Array.isArray(paras) ? paras.join(' ') : String(paras || '');
        if (body) records.push({ title: 'المادة ' + (item.num != null ? item.num : (item.number != null ? item.number : (item.title || ''))), body: body, bookName: bookName, chapterName: chapterName, sectionName: sectionName, num: item.num != null ? item.num : item.number });
      });
    }
    (law.books || []).forEach(function (book) {
      addArticles(book.articles, book.name || book.title, '', '');
      (book.chapters || []).forEach(function (chapter) {
        addArticles(chapter.articles, book.name || book.title, chapter.name || chapter.label, '');
        (chapter.sections || []).forEach(function (section) {
          addArticles(section.articles, book.name || book.title, chapter.name || chapter.label, section.name || section.label);
        });
      });
    });

    const stop = new Set(['في','من','على','عن','الى','الي','هل','ما','هو','هي','ايه','اي','كم','كيف','متى','ماذا','قانون','العمل','المصري','المصريه','ماده','الماده','مواد','بخصوص','حسب','طبقا','وفقا','the','what','is','are','how','can','i','my','in','of','to','for','egyptian','labor','labour','law']);
    const tokens = m.split(/[^\p{L}\p{N}]+/u).filter(function (t) { return t.length > 1 && !stop.has(t); });
    if (!tokens.length) {
      return { reply: tr(ctx, 'اكتب موضوعًا محددًا أو رقم المادة اللي عاوزها — مثلاً: «المادة 41» أو «ساعات العمل».', 'Ask about a specific labor-law topic or article number — e.g., "article 41" or "working hours".'), ok: true };
    }
    const ranked = records.map(function (rec) {
      const text = normalize(rec.title + ' ' + rec.body + ' ' + (rec.bookName || '') + ' ' + (rec.chapterName || '') + ' ' + (rec.sectionName || ''));
      let score = 0;
      tokens.forEach(function (token) { if (text.indexOf(token) >= 0) score += token.length > 4 ? 2 : 1; });
      const numMatch = m.match(/(?:الماده|ماده|article)\s*(\d+)/i);
      if (numMatch && String(rec.num || '') === numMatch[1]) score += 20;
      return Object.assign({}, rec, { score: score });
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);

    if (!ranked.length) {
      return { reply: tr(ctx, 'ملقتش مادة واضحة مطابقة لسؤالك في نسخة القانون الموجودة بالتطبيق. جرّب كلمات أدق أو رقم المادة، ومش هخمن إجابة قانونية من غير نص مناسب.', 'I could not find a clear matching provision in the law text bundled with the app. Try more specific keywords or an article number; I will not guess a legal answer without a matching source.'), ok: true };
    }
    const heading = tr(ctx, 'نتائج من نص قانون العمل المصري رقم 14 لسنة 2025:', 'Results from the Egyptian Labor Law No. 14 of 2025:');
    const results = ranked.map(function (rec) {
      const snippet = rec.body.length > 650 ? rec.body.slice(0, 647).trim() + '…' : rec.body;
      const meta = [rec.bookName, rec.chapterName, rec.sectionName].filter(Boolean).join(' — ');
      return (rec.title || tr(ctx, 'نص قانوني', 'Legal text')) + (meta ? ' (' + meta + ')' : '') + '\n' + snippet;
    });
    return {
      reply: heading + '\n\n' + results.join('\n\n') + '\n\n' + tr(ctx, 'تنبيه: ده استرجاع من النص المرفق بالتطبيق وليس استشارة قانونية. راجع النص الكامل والسياق والتعديلات الرسمية قبل اتخاذ قرار. اكتب «اشرح اكتر» لو حابب تبسيط أو شرح أعمق لنفس المادة.', 'Note: This is retrieval from the law text bundled with the app, not legal advice. Check the full provision, context, and official amendments before acting. Type "explain more" if you want a deeper or simplified explanation of the same article.'),
      ok: true,
      action: 'law:search',
      contextForApi: results.join('\n\n') // grounds the API fallback in the same retrieved text
    };
  }

  // ---------- Help / capabilities text ----------
  function execHelp(ctx) {
    if (isAr(ctx)) {
      return {
        reply: 'أنا نوفا — مساعدك في ShiftPro. اقدر أعمل كتير، منها:\n' +
          '• التنقل: «افتح التقارير»، «افتح الراتب»، «افتح المحفظة»، «افتح القانون»\n' +
          '• الحضور: «سجل حضور»، «سجل انصراف»، «افتح تفاصيل يوم 12 يناير»\n' +
          '• الراتب: «احسب راتبي»، «ساعات الأوفرتايم»، «الخصومات»\n' +
          '• المحفظة: «رصيد المحفظة»، «اعرض المحافظ»، «ضيف معاملة 50»\n' +
          '• الإجازات: «رصيد الإجازات»، «طلبات الإجازة»\n' +
          '• النسخ الاحتياطي: «اعمل نسخة احتياطية»، «صدر JSON»، «صدر CSV»\n' +
          '• التقارير: «طلع تقرير PDF»، «صدر Excel»\n' +
          '• التراجع/الإعادة: «تراجع»، «اعمل redo»\n' +
          '• اللغة والمظهر: «غير اللغة للإنجليزي»، «غير الثيم»\n' +
          '• القانون: دور على أي مادة — مثلاً «المادة 41» أو «ساعات العمل»\n' +
          '• اكتب «اشرح اكتر» بعد أي نتيجة قانون علشان أبسطها أو أشرحها أعمق (بيستخدم API خارجي اختياري).',
        ok: true
      };
    }
    return {
      reply: 'I\'m NOVA — your ShiftPro assistant. I can do a lot, including:\n' +
        '• Navigation: "open reports", "open salary", "open wallet", "open law"\n' +
        '• Attendance: "check in", "check out", "open day 12 January"\n' +
        '• Salary: "compute my salary", "overtime hours", "deductions"\n' +
        '• Wallet: "wallet balance", "list wallets", "add transaction 50"\n' +
        '• Leaves: "leave balance", "leave requests"\n' +
        '• Backup: "create backup", "export JSON", "export CSV"\n' +
        '• Reports: "export PDF", "export Excel"\n' +
        '• Undo/Redo: "undo", "redo"\n' +
        '• Language & theme: "switch to English", "toggle theme"\n' +
        '• Law: search any article — e.g. "article 41" or "working hours"\n' +
        '• Type "explain more" after any legal result for a deeper or simplified explanation (uses an optional external API).',
      ok: true
    };
  }

  // ---------- Executor dispatch table ----------
  // Returns `{ reply, ok, action? }`.
  // `confirmed` = true means the UI already obtained user confirmation.
  function execute(intent, params, ctx, confirmed) {
    ctx = ctx || {};
    params = params || {};

    function needConfirm() {
      return { reply: tr(ctx, 'محتاج تأكيد. اضغط زر التأكيد في التطبيق لإكمال العملية.', 'Confirmation needed. Click the confirm button in the app to complete the action.'), ok: false, needsConfirm: true };
    }

    switch (intent) {
      case 'greeting':
        return { reply: isAr(ctx) ? 'أهلًا يا ' + workerName(ctx) + '! كيف أقدر أساعدك؟' : 'Hi ' + workerName(ctx) + '! How can I help?', ok: true };
      case 'thanks':
        return { reply: isAr(ctx) ? 'العفو يا ' + workerName(ctx) + ' 🌟' : 'You\'re welcome, ' + workerName(ctx) + '!', ok: true };
      case 'help':
        return execHelp(ctx);

      case 'nav_dashboard': return execNav(ctx, 'dashboard');
      case 'nav_calendar':  return execNav(ctx, 'calendar');
      case 'nav_salary':    return execNav(ctx, 'salary');
      case 'nav_reports':   return execNav(ctx, 'reports');
      case 'nav_wallet':    return execNav(ctx, 'wallet');
      case 'nav_law':       return execNav(ctx, 'law');
      case 'nav_settings':  return execNav(ctx, 'more');

      case 'attendance_checkin':
        if (!confirmed) return needConfirm();
        return execCheckIn(ctx);
      case 'attendance_checkout':
        if (!confirmed) return needConfirm();
        return execCheckOut(ctx);
      case 'attendance_open_day':
        if (params.missing && params.missing.indexOf('date') >= 0) {
          return { reply: tr(ctx, 'حدد التاريخ — مثلاً: «افتح تفاصيل يوم 12 يناير».', 'Please specify a date — e.g., "open day 12 January".'), ok: false };
        }
        return execOpenDay(ctx, params.date);

      case 'salary_compute':    return execSalaryCompute(ctx);
      case 'salary_overtime':   return execSalaryOvertime(ctx);
      case 'salary_deductions': return execSalaryDeductions(ctx);
      case 'salary_summary':    return execSalaryCompute(ctx);

      case 'wallet_balance':  return execWalletBalance(ctx);
      case 'wallet_list':     return execWalletList(ctx);
      case 'wallet_open':     return execWalletOpen(ctx);
      case 'wallet_add_tx':
        if (params.missing && params.missing.indexOf('amount') >= 0) {
          return { reply: tr(ctx, 'حدد مبلغ المعاملة.', 'Please specify the transaction amount.'), ok: false };
        }
        if (!confirmed) return needConfirm();
        return execWalletAddTx(ctx, params);
      case 'wallet_transfer':
        if (!confirmed) return needConfirm();
        return execWalletOpen(ctx); // simplified: open wallet, user fills transfer form

      case 'leaves_balance':  return execLeavesBalance(ctx);
      case 'leaves_list':     return execLeavesList(ctx);

      case 'backup_create':
        if (!confirmed) return needConfirm();
        return execBackupCreate(ctx);
      case 'backup_export_json': return execBackupExportJSON(ctx);
      case 'backup_export_csv':  return execBackupExportCSV(ctx);

      case 'reports_export_csv':  return execReportsExportCSV(ctx);
      case 'reports_export_xlsx': return execReportsExportXLSX(ctx);
      case 'reports_export_pdf':  return execReportsExportPDF(ctx);

      case 'undo': return execUndo(ctx);
      case 'redo': return execRedo(ctx);

      case 'lang_ar': return execLang(ctx, 'ar');
      case 'lang_en': return execLang(ctx, 'en');

      case 'theme_toggle':    return execThemeToggle(ctx);
      case 'open_appearance': return execOpenSheet(ctx, 'datetime');

      case 'open_settings_general':      return execOpenSheet(ctx, 'settings');
      case 'open_settings_salary':       return execOpenSheet(ctx, 'salarySettings');
      case 'open_settings_shifts':       return execOpenSheet(ctx, 'shifts');
      case 'open_settings_leave':         return execOpenSheet(ctx, 'leave');
      case 'open_settings_datetime':      return execOpenSheet(ctx, 'datetime');
      case 'open_settings_notifications': return execOpenSheet(ctx, 'notifications');
      case 'open_settings_control':       return execOpenSheet(ctx, 'control');
      case 'open_settings_stats':         return execOpenSheet(ctx, 'stats');
      case 'open_settings_backup':        return execOpenSheet(ctx, 'backup');
      case 'open_settings_about':         return execOpenSheet(ctx, 'about');

      case 'law_search': return execLawSearch(ctx, params.raw || '');

      case 'explain_more':
        // Handled by the API layer (caller); return neutral marker.
        return { reply: '', ok: true, action: 'api:explain-more', needsApi: true };

      default:
        return { reply: isAr(ctx)
          ? 'مش قادر أفهم طلبك ده لسه. اكتب «مساعدة» علشان تشوف اللي اقدر أعمله.'
          : 'I don\'t understand that request yet. Type "help" to see what I can do.',
          ok: false };
    }
  }

  // ---------- Orchestrator ----------
  // handle(message, ctx, options) → { reply, ok, action?, contextForApi?, needsApi? }
  function handle(message, ctx, options) {
    ctx = ctx || global; // default to window/global
    options = options || {};
    const intent = detectIntent(message, ctx);
    if (intent.kind === 'unsupported' || intent.intent === 'unknown') {
      return {
        reply: isAr(ctx)
          ? 'مش قادر أفهم طلبك ده لسه. اكتب «مساعدة» علشان تشوف اللي اقدر أعمله.'
          : 'I don\'t understand that request yet. Type "help" to see what I can do.',
        ok: false
      };
    }
    if (intent.kind === 'api') {
      // Caller (UI) should send to API with this as the user message.
      return { reply: '', ok: true, needsApi: true, action: 'api:explain-more', original: message };
    }
    // Local / law
    const res = execute(intent.intent, Object.assign({}, intent.params, { raw: message, missing: intent.missing }), ctx, options.confirmed === true);
    if (res && res.contextForApi) {
      res.needsApi = false; // explicit; the UI may choose to follow up with API later
    }
    return res;
  }

  // ---------- Public API ----------
  global.SPAssistantRouter = {
    normalize,
    detectIntent,
    execute,
    handle,
    extractDate,
    extractTime,
    extractNumber,
    INTENTS,
    // Adapters exposed for unit testing
    _adapters: {
      execNav, execCheckIn, execCheckOut, execOpenDay,
      execSalaryCompute, execSalaryOvertime, execSalaryDeductions,
      execWalletBalance, execWalletList, execWalletOpen, execWalletAddTx,
      execLeavesBalance, execLeavesList,
      execBackupCreate, execBackupExportJSON, execBackupExportCSV,
      execReportsExportCSV, execReportsExportXLSX, execReportsExportPDF,
      execUndo, execRedo, execLang, execThemeToggle, execOpenSheet,
      execLawSearch, execHelp
    }
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
