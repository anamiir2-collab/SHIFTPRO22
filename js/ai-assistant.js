/* ShiftPro Mero assistant — local-only, allowlisted task assistant.
 * No external AI/API integration, no microphone, and no speech playback.
 * Task buttons dispatch only to the existing SPAssistantRouter functions.
 */
(function (global) {
  'use strict';

  const MAX_MESSAGE = 2000;
  let busy = false;
  let pendingFollowUp = null;
  const locale = () => (global.SPi18n && global.SPi18n.getLocale) ? global.SPi18n.getLocale() : 'ar';
  const isAr = () => locale() !== 'en';
  const tr = (ar, en) => isAr() ? ar : en;

  function make(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function workerName() {
    const el = document.getElementById('workerName') || document.getElementById('heroName');
    const name = (el && el.textContent || '').trim();
    return (!name || name === '—') ? tr('صديقي', 'there') : name;
  }

  function addMessage(list, role, text) {
    const row = make('div', 'sp-ai-message ' + (role === 'user' ? 'is-user' : 'is-assistant'), String(text || ''));
    row.setAttribute('role', 'listitem');
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return row;
  }

  function setBusy(value, send, input, taskButtons) {
    busy = value;
    if (send) {
      send.disabled = value;
      send.textContent = value ? '…' : tr('إرسال', 'Send');
    }
    if (input) input.disabled = value;
    (taskButtons || []).forEach(button => { button.disabled = value; });
  }

  function openPanel(panel, input) {
    panel.hidden = false;
    panel.classList.add('is-open');
    if (input) input.focus();
  }

  function closePanel(panel, launcher) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    if (launcher) launcher.focus();
  }

  function confirmAction(intent) {
    const message = tr(
      'ميرو هتنفذ الإجراء "' + intent + '". هل تؤكد التنفيذ؟',
      'Mero is about to run "' + intent + '". Do you want to continue?'
    );
    try { return typeof global.confirm === 'function' && global.confirm(message); }
    catch (_) { return false; }
  }

  async function processMessage(message) {
    let text = String(message || '').trim().slice(0, MAX_MESSAGE);
    if (!text) return tr('اكتب طلبك أو اختار مهمة من القائمة.', 'Type a request or choose a task from the menu.');
    if (pendingFollowUp) {
      const follow = text;
      const isAmount = pendingFollowUp.missing === 'amount' && /^\d+(?:[.,]\d{1,2})?$/.test(follow);
      const isDate = pendingFollowUp.missing === 'date' && /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+\S+|today|yesterday|tomorrow|اليوم|النهارده|امبارح|امس|بكره|غدا)/i.test(follow);
      if (isAmount || isDate) text = pendingFollowUp.command + ' ' + follow;
      pendingFollowUp = null;
    }

    const router = global.SPAssistantRouter;
    if (!router || typeof router.detectIntent !== 'function' || typeof router.execute !== 'function') {
      return tr('مساعد ميرو غير متاح حاليًا لأن وحدة الأوامر لم تُحمّل. حدّث التطبيق وحاول مرة أخرى.', 'Mero is unavailable because its command module did not load. Refresh the app and try again.');
    }

    let intent;
    try { intent = router.detectIntent(text, global); }
    catch (_) { intent = null; }

    if (!intent || !intent.intent || intent.kind === 'unsupported' || intent.intent === 'unknown') {
      return tr(
        'مش لاقي مهمة مطابقة للطلب ده. اختار مهمة من القائمة أو اكتب «مساعدة».',
        'I could not match that request to a supported task. Choose a task from the menu or type “help”.'
      );
    }

    if (intent.kind === 'law' || intent.intent === 'law_search') {
      try {
        const result = router.execute('law_search', { raw: text }, global, false);
        return result && result.reply ? result.reply : tr('لم أجد مادة مطابقة في محتوى القانون المتاح داخل التطبيق.', 'No matching article was found in the labor-law content available in the app.');
      } catch (_) {
        return tr('تعذّر البحث في محتوى قانون العمل حاليًا.', 'Labor-law search is currently unavailable.');
      }
    }

    if (intent.intent === 'explain_more') {
      return tr(
        'ميرو يعمل محليًا من غير خدمة ذكاء اصطناعي خارجية. افتح المادة القانونية المطلوبة من القائمة واقرأ النص المعروض داخل التطبيق؛ لن أرسل بياناتك لخدمة خارجية.',
        'Mero runs locally without an external AI service. Open the relevant labor-law article from the menu and review the text shown in the app; your data will not be sent to an external service.'
      );
    }

    if (intent.kind === 'local') {
      if (intent.missing && intent.missing.length) {
        const missing = intent.missing[0];
        if (missing === 'date') { pendingFollowUp = { command: text, missing: 'date' }; return tr('حدد التاريخ — مثال: «افتح تفاصيل يوم 12 يناير».', 'Please specify a date — for example, “open day 12 January”.'); }
        if (missing === 'amount') { pendingFollowUp = { command: text, missing: 'amount' }; return tr('حدد مبلغ المعاملة قبل المتابعة.', 'Enter the transaction amount before continuing.'); }
        return tr('محتاج بيانات إضافية: ' + missing, 'Additional information is required: ' + missing);
      }

      const confirmed = intent.needsConfirm ? confirmAction(intent.intent) : true;
      if (!confirmed) return tr('تم إلغاء العملية ولم يتم تنفيذها.', 'Cancelled. No action was taken.');

      try {
        const result = router.execute(
          intent.intent,
          Object.assign({}, intent.params || {}, { raw: text, missing: intent.missing || [] }),
          global,
          confirmed
        );
        return result && result.reply ? result.reply : tr('لم يرجع الإجراء نتيجة واضحة. راجع القسم المرتبط بالمهمة.', 'The action returned no clear result. Please check the related app section.');
      } catch (_) {
        return tr('حصل خطأ أثناء تنفيذ المهمة. لم أقدر أؤكد نجاحها؛ افتح القسم المرتبط وحاول مرة أخرى.', 'An error occurred while running this task. I could not verify success; open the related section and try again.');
      }
    }

    // Small talk and help are handled through the same local router.
    try {
      const result = router.execute(intent.intent, Object.assign({}, intent.params || {}, { raw: text }), global, false);
      if (result && result.reply) return result.reply;
    } catch (_) {}
    return tr('اختار مهمة من القائمة علشان أنفذها من وظائف ShiftPro الموجودة.', 'Choose a task from the menu so I can run an existing ShiftPro function.');
  }

  const TASK_GROUPS = [
    {
      ar: 'التنقل داخل التطبيق', en: 'App navigation',
      tasks: [
        ['افتح الرئيسية', 'Open dashboard'],
        ['افتح التقويم', 'Open calendar'],
        ['افتح الراتب', 'Open salary'],
        ['افتح التقارير', 'Open reports'],
        ['افتح المحفظة', 'Open wallet'],
        ['افتح قانون العمل', 'Open labor law'],
        ['افتح الإعدادات', 'Open settings'],
        ['افتح عن التطبيق', 'Open about'],
        ['افتح الإعدادات العامة', 'Open general settings'],
        ['افتح التحكم في التطبيق', 'Open control panel'],
        ['افتح إعدادات التاريخ والوقت', 'Open date time settings'],
        ['افتح إعدادات المظهر', 'Open appearance settings'],
        ['افتح الإحصائيات', 'Open stats']
      ]
    },
    {
      ar: 'الحضور والورديات', en: 'Attendance and shifts',
      tasks: [
        ['سجل حضور', 'Check in'],
        ['سجل انصراف', 'Check out'],
        ['افتح تفاصيل يوم اليوم', 'Open day today'],
        ['افتح إدارة الورديات', 'Open shifts manager'],
        ['رصيد الإجازات', 'Leave balance'],
        ['طلبات الإجازة', 'Leave requests']
      ]
    },
    {
      ar: 'الراتب والحسابات', en: 'Salary and compensation',
      tasks: [
        ['احسب راتبي', 'Calculate my salary'],
        ['ملخص الراتب', 'Salary summary'],
        ['ساعات الإضافي', 'Overtime hours'],
        ['الخصومات', 'Salary deductions'],
        ['رصيد المحفظة', 'Wallet balance'],
        ['اعرض المحافظ', 'List wallets'],
        ['افتح تفاصيل المحفظة', 'Open wallet details'],
        ['ضيف معاملة', 'Add transaction'],
        ['حول من محفظة', 'Transfer between wallets']
      ]
    },
    {
      ar: 'التقارير والنسخ الاحتياطي', en: 'Reports and backup',
      tasks: [
        ['تقرير pdf', 'Export PDF report'],
        ['تقرير اكسل', 'Export Excel report'],
        ['تقرير csv', 'Report CSV'],
        ['تصدير json', 'Export JSON backup'],
        ['اعمل نسخة احتياطية', 'Create backup']
      ]
    },
    {
      ar: 'الإعدادات وأدوات التطبيق', en: 'Settings and app tools',
      tasks: [
        ['غير اللغة للإنجليزي', 'Switch to English'],
        ['غير اللغة للعربي', 'Switch to Arabic'],
        ['غير المظهر', 'Toggle theme'],
        ['افتح الإشعارات', 'Open notifications'],
        ['افتح إعدادات الراتب', 'Open salary settings'],
        ['افتح الإجازات', 'Open leave settings'],
        ['افتح النسخ الاحتياطي', 'Open backup settings'],
        ['تراجع', 'Undo'],
        ['redo', 'Redo']
      ]
    },
    {
      ar: 'قانون العمل والمساعدة', en: 'Labor law and help',
      tasks: [
        ['دوّر على المادة 41', 'Search article 41'],
        ['دوّر على ساعات العمل', 'Search working hours'],
        ['مساعدة', 'Help']
      ]
    }
  ];

  function buildTaskMenu(input, messages, taskButtonsRef) {
    const menu = make('div', 'sp-ai-task-menu');
    menu.setAttribute('aria-label', tr('قائمة مهام ميرو', 'Mero task menu'));
    menu.appendChild(make('p', 'sp-ai-menu-intro', tr(
      'اختار المهمة المطلوبة. الأزرار بتشغّل وظائف ShiftPro الموجودة فقط.',
      'Choose a task. Buttons run only existing ShiftPro functions.'
    )));
    TASK_GROUPS.forEach(group => {
      const section = make('section', 'sp-ai-task-group');
      section.appendChild(make('h4', 'sp-ai-task-heading', isAr() ? group.ar : group.en));
      const grid = make('div', 'sp-ai-task-grid');
      group.tasks.forEach(task => {
        const command = isAr() ? task[0] : task[1];
        const button = make('button', 'sp-ai-task', command);
        button.type = 'button';
        button.setAttribute('data-command', command);
        button.addEventListener('click', () => {
          input.value = '';
          runCommand(command, messages, input, null, taskButtonsRef);
        });
        grid.appendChild(button);
        taskButtonsRef.push(button);
      });
      section.appendChild(grid);
      menu.appendChild(section);
    });
    return menu;
  }

  async function runCommand(command, messages, input, send, taskButtons) {
    if (busy) return;
    setBusy(true, send, input, taskButtons || []);
    addMessage(messages, 'user', command);
    if (input) input.value = '';
    const reply = await processMessage(command);
    addMessage(messages, 'assistant', reply);
    setBusy(false, send, input, taskButtons || []);
    if (input) input.focus();
  }

  function init() {
    if (document.getElementById('spAiLauncher')) return;

    // Remove only legacy assistant configuration/context keys; leave all app data untouched.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i) || '';
        if (/^shiftpro_.*(?:_api_key|_ai_endpoint|_ai_last_context)$/i.test(key)) localStorage.removeItem(key);
      }
    } catch (_) {}

    const launcher = make('button', 'sp-ai-launcher');
    launcher.id = 'spAiLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', tr('افتح ميرو مساعد ShiftPro', 'Open Mero, the ShiftPro assistant'));
    launcher.title = tr('ميرو — مساعد ShiftPro', 'Mero — ShiftPro assistant');
    launcher.innerHTML = '<svg class="sp-ai-robot" viewBox="0 0 64 64" aria-hidden="true"><path class="robot-antenna" d="M32 8v7"/><circle cx="32" cy="6" r="3"/><rect x="11" y="17" width="42" height="34" rx="12"/><path class="robot-ear" d="M7 29v10m50-10v10"/><rect class="robot-face" x="17" y="23" width="30" height="20" rx="7"/><circle class="robot-eye" cx="25" cy="32" r="3"/><circle class="robot-eye" cx="39" cy="32" r="3"/><path class="robot-mouth" d="M25 38q7 5 14 0"/><path class="robot-body" d="M21 52v5m22-5v5"/></svg><span class="sp-ai-online"></span>';

    const bubble = make('button', 'sp-ai-nudge', tr('هل تحتاج مساعدة يا ' + workerName() + '؟', 'Need any help, ' + workerName() + '?'));
    bubble.type = 'button';
    bubble.hidden = true;
    bubble.setAttribute('aria-label', tr('افتح ميرو للمساعدة', 'Open Mero for help'));

    const panel = make('section', 'sp-ai-panel');
    panel.id = 'spAiPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'spAiTitle');

    const header = make('div', 'sp-ai-header');
    const titleWrap = make('div', 'sp-ai-title-wrap');
    const title = make('strong', '', 'Mero · ميرو');
    title.id = 'spAiTitle';
    titleWrap.append(title, make('small', '', tr('مساعد ShiftPro للمهام اليومية', 'ShiftPro task assistant')));
    const close = make('button', 'sp-ai-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('إغلاق', 'Close'));
    const robot = make('div', 'sp-ai-header-robot');
    robot.innerHTML = launcher.innerHTML;
    header.append(robot, titleWrap, close);

    const notice = make('div', 'sp-ai-notice', tr(
      'ميرو ينفّذ الأوامر المدعومة محليًا من داخل التطبيق. لا توجد خدمة ذكاء اصطناعي خارجية في هذه النسخة.',
      'Mero runs supported commands locally inside the app. This version has no external AI service.'
    ));

    const messages = make('div', 'sp-ai-messages');
    messages.id = 'spAiMessages';
    messages.setAttribute('role', 'list');
    addMessage(messages, 'assistant', tr(
      'أهلًا يا ' + workerName() + '! أنا ميرو. اختار مهمة من القائمة أو اكتب طلبك. قبل الإجراءات الحساسة هطلب منك التأكيد، ولو وظيفة مش موجودة هقولك بوضوح.',
      'Hi ' + workerName() + '! I’m Mero. Choose a task from the menu or type a request. I’ll ask before sensitive actions and clearly tell you when a feature is unavailable.'
    ));

    const taskButtons = [];
    const input = make('textarea', 'sp-ai-input');
    input.id = 'spAiInput';
    input.rows = 2;
    input.maxLength = MAX_MESSAGE;
    input.placeholder = tr('اكتب طلبك هنا…', 'Type your request here…');
    input.setAttribute('aria-label', input.placeholder);

    const send = make('button', 'sp-ai-send', tr('إرسال', 'Send'));
    send.type = 'submit';

    const form = make('form', 'sp-ai-form');
    form.append(input, send);

    // Four everyday shortcuts keep the assistant simple; the full task catalogue stays optional.
    const shortcuts = make('div', 'sp-ai-shortcuts');
    const quickTasks = [
      ['سجل حضور', 'Check in'],
      ['افتح إدارة الورديات', 'Open shifts'],
      ['ملخص الراتب', 'Salary summary'],
      ['افتح التقارير', 'Open reports']
    ];
    quickTasks.forEach(task => {
      const command = isAr() ? task[0] : task[1];
      const button = make('button', 'sp-ai-shortcut', command);
      button.type = 'button';
      button.addEventListener('click', () => runCommand(command, messages, input, send, taskButtons));
      shortcuts.appendChild(button);
    });

    const taskMenu = buildTaskMenu(input, messages, taskButtons);
    taskMenu.hidden = true;
    const controls = make('div', 'sp-ai-controls');
    const menuButton = make('button', 'sp-ai-control', tr('كل المهام', 'All tasks'));
    menuButton.type = 'button';
    menuButton.setAttribute('aria-expanded', 'false');
    const cancelButton = make('button', 'sp-ai-control', tr('مسح الكتابة', 'Clear input'));
    cancelButton.type = 'button';
    controls.append(menuButton, cancelButton);

    const footer = make('small', 'sp-ai-footer', tr(
      'ميرو يستخدم وظائف ShiftPro الموجودة فقط، ويطلب التأكيد قبل الإجراءات المهمة.',
      'Mero uses existing ShiftPro functions only and asks before important actions.'
    ));

    panel.append(header, notice, messages, shortcuts, taskMenu, controls, form, footer);
    document.body.append(launcher, bubble, panel);

    menuButton.addEventListener('click', () => {
      taskMenu.hidden = !taskMenu.hidden;
      menuButton.setAttribute('aria-expanded', String(!taskMenu.hidden));
      menuButton.textContent = taskMenu.hidden ? tr('كل المهام', 'All tasks') : tr('إخفاء المهام', 'Hide tasks');
    });
    cancelButton.addEventListener('click', () => {
      input.value = '';
      input.focus();
    });

    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) closePanel(panel, launcher);
    });

    launcher.addEventListener('click', () => {
      bubble.hidden = true;
      panel.hidden ? openPanel(panel, input) : closePanel(panel, launcher);
    });
    bubble.addEventListener('click', () => {
      bubble.hidden = true;
      openPanel(panel, input);
    });
    close.addEventListener('click', () => closePanel(panel, launcher));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const message = input.value.trim();
      if (!message) return;
      if (message.length > MAX_MESSAGE) {
        addMessage(messages, 'assistant', tr('الطلب طويل جدًا. اختصره من فضلك.', 'That request is too long. Please shorten it.'));
        return;
      }
      await runCommand(message, messages, input, send, taskButtons);
    });

    // Keep the More-page assistant entry as a shortcut to the real task menu.
    const moreHelp = document.getElementById('moreMeroHelpBtn');
    if (moreHelp) moreHelp.addEventListener('click', () => openPanel(panel, input));

    let nudgeIndex = 0;
    global.setInterval(() => {
      if (panel.hidden && !document.hidden) {
        bubble.textContent = nudgeIndex++ % 2 === 0
          ? tr('هل تحتاج مساعدة يا ' + workerName() + '؟', 'Need any help, ' + workerName() + '?')
          : tr('ميرو هنا لو احتجت أي حاجة', 'Mero is here if you need anything');
        bubble.hidden = false;
        bubble.classList.add('is-visible');
        global.setTimeout(() => {
          bubble.classList.remove('is-visible');
          global.setTimeout(() => { bubble.hidden = true; }, 350);
        }, 7000);
      }
    }, 60000);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  global.SPAssistant = {
    init,
    open: function () {
      const panel = document.getElementById('spAiPanel');
      const input = document.getElementById('spAiInput');
      if (panel) openPanel(panel, input);
    },
    // Test seam: dispatch a message through the same local command router.
    _processMessage: processMessage
  };
})(typeof window !== 'undefined' ? window : this);
