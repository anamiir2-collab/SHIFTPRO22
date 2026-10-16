/* ShiftPro Smart Assistant
 * Frontend-only UI. AI requests are sent to a separately deployed secure Worker.
 * No API key or secret is stored in this file. The assistant cannot execute app
 * mutations yet; that requires explicit, allow-listed action handlers and review.
 */
(function (global) {
  'use strict';

  const ENDPOINT_KEY = 'shiftpro_ai_endpoint';
  const LOCAL_KEY = 'shiftpro_codecraft_api_key';
  const DEFAULT_ENDPOINT = 'https://YOUR-WORKER.workers.dev/api/assistant';
  const CODECRAFT_URL = 'https://codecraftapi.com/v1/chat/completions';
  const CODECRAFT_MODEL = 'claude-opus-4.8';
  const MAX_MESSAGE = 2000;
  let busy = false;

  const locale = () => global.SPi18n ? global.SPi18n.getLocale() : 'ar';
  const isAr = () => locale() !== 'en';
  const tr = (ar, en) => isAr() ? ar : en;

  function getEndpoint() {
    try { return (localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT).trim(); }
    catch (_) { return DEFAULT_ENDPOINT; }
  }

  function getLocalApiKey() {
    try { return (localStorage.getItem(LOCAL_KEY) || '').trim(); }
    catch (_) { return ''; }
  }

  function make(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function addMessage(list, role, text) {
    const row = make('div', 'sp-ai-message ' + (role === 'user' ? 'is-user' : 'is-assistant'));
    row.setAttribute('role', 'listitem');
    row.textContent = text;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return row;
  }

  function setBusy(value, sendBtn, input) {
    busy = value;
    sendBtn.disabled = value;
    input.disabled = value;
    sendBtn.textContent = value ? '…' : tr('إرسال', 'Send');
  }

  function openPanel(panel, input) {
    panel.hidden = false;
    panel.classList.add('is-open');
    input.focus();
  }
  function closePanel(panel, launcher) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    launcher.focus();
  }

  function init() {
    if (document.getElementById('spAiLauncher')) return;

    const launcher = make('button', 'sp-ai-launcher', '✦');
    launcher.id = 'spAiLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', tr('افتح مساعد ShiftPro الذكي', 'Open ShiftPro Smart Assistant'));
    launcher.title = tr('مساعد ShiftPro الذكي', 'ShiftPro Smart Assistant');

    const panel = make('section', 'sp-ai-panel');
    panel.id = 'spAiPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'spAiTitle');

    const header = make('div', 'sp-ai-header');
    const titleWrap = make('div', 'sp-ai-title-wrap');
    titleWrap.appendChild(make('strong', '', tr('مساعد ShiftPro الذكي', 'ShiftPro Smart Assistant')));
    titleWrap.firstChild.id = 'spAiTitle';
    titleWrap.appendChild(make('small', '', tr('اكتب طلبك بلغة بسيطة', 'Describe what you need in plain language')));
    const close = make('button', 'sp-ai-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('إغلاق', 'Close'));
    header.append(titleWrap, close);

    const notice = make('div', 'sp-ai-notice', tr(
      'وضع التجربة المباشرة اختياري: المفتاح يُحفظ في هذا المتصفح فقط، لكنه سيكون قابلًا للاستخراج من المتصفح وقد ترفض الخدمة طلبات CORS. لا تستخدم مفتاحًا مهمًا أو عليه رصيد كبير.',
      'Optional direct test mode: the key is stored only in this browser, but can be extracted from the browser and the API may block CORS. Use a disposable, low-limit test key only.'
    ));
    notice.id = 'spAiNotice';

    const localKeyBtn = make('button', 'sp-ai-key-btn', tr('إعداد مفتاح التجربة على هذا الجهاز', 'Set local test API key'));
    localKeyBtn.type = 'button';
    localKeyBtn.addEventListener('click', () => {
      const existing = getLocalApiKey();
      const entered = global.prompt(tr('أدخل مفتاح CodeCraft التجريبي. لا تستخدم مفتاحًا مهمًا؛ سيتم حفظه في تخزين هذا المتصفح فقط.', 'Enter a disposable CodeCraft test key. It will be stored in this browser only.'), '');
      if (entered === null) return;
      if (!entered.trim()) {
        try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
        addMessage(messages, 'assistant', tr('تم مسح مفتاح التجربة المحلي من هذا المتصفح.', 'Local test key cleared from this browser.'));
        return;
      }
      try {
        localStorage.setItem(LOCAL_KEY, entered.trim());
        addMessage(messages, 'assistant', tr('تم حفظ مفتاح التجربة محليًا. جرّب إرسال رسالة؛ قد تمنع الخدمة الاتصال المباشر من المتصفح.', 'Test key saved locally. Try sending a message; the provider may block direct browser requests.'));
      } catch (_) {
        addMessage(messages, 'assistant', tr('تعذر حفظ المفتاح في تخزين المتصفح.', 'Could not save the key in browser storage.'));
      }
    });

    const messages = make('div', 'sp-ai-messages');
    messages.id = 'spAiMessages';
    messages.setAttribute('role', 'list');
    addMessage(messages, 'assistant', tr(
      'أهلًا بك! بعد ربط الخادم أقدر أساعدك في فهم طلباتك. تنفيذ تغييرات الحضور أو الرواتب أو الحذف سيحتاج تأكيدًا صريحًا.',
      'Welcome! Once the backend is connected, I can help interpret your requests. Attendance, payroll, and deletion changes will require explicit confirmation.'
    ));

    const examples = make('div', 'sp-ai-examples');
    [
      tr('اعرض ملخص راتبي الحالي', 'Summarize my current payroll'),
      tr('ساعدني أنظم محافظي', 'Help me organize my wallets'),
      tr('افتح التقارير', 'Open reports')
    ].forEach((example) => {
      const b = make('button', '', example);
      b.type = 'button';
      b.addEventListener('click', () => { input.value = example; input.focus(); });
      examples.appendChild(b);
    });

    const form = make('form', 'sp-ai-form');
    const input = make('textarea', 'sp-ai-input');
    input.id = 'spAiInput';
    input.rows = 2;
    input.maxLength = MAX_MESSAGE;
    input.required = true;
    input.placeholder = tr('اكتب المهمة هنا…', 'Write your task here…');
    input.setAttribute('aria-label', input.placeholder);
    const send = make('button', 'sp-ai-send', tr('إرسال', 'Send'));
    send.type = 'submit';
    form.append(input, send);

    const footer = make('small', 'sp-ai-footer', tr(
      'نسخة تجهيزية: لا تنفذ أو تغيّر بيانات التطبيق حاليًا.',
      'Setup mode: this version does not change app data.'
    ));

    panel.append(header, notice, localKeyBtn, messages, examples, form, footer);
    document.body.append(launcher, panel);

    launcher.addEventListener('click', () => panel.hidden ? openPanel(panel, input) : closePanel(panel, launcher));
    close.addEventListener('click', () => closePanel(panel, launcher));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const message = input.value.trim();
      if (!message) return;
      if (message.length > MAX_MESSAGE) {
        addMessage(messages, 'assistant', tr('الطلب طويل جدًا. اختصره من فضلك.', 'That request is too long. Please shorten it.'));
        return;
      }
      addMessage(messages, 'user', message);
      input.value = '';
      const localApiKey = getLocalApiKey();
      const endpoint = getEndpoint();
      if (!localApiKey && (!endpoint || endpoint.includes('YOUR-WORKER.workers.dev'))) {
        addMessage(messages, 'assistant', tr(
          'الواجهة جاهزة لكن الخادم لم يُربط بعد. انشر مجلد worker ثم ضع عنوانه في إعدادات الربط داخل ملف js/ai-assistant.js بدل العنوان التجريبي.',
          'The interface is ready, but the backend is not connected. Deploy the worker folder, then configure its URL in js/ai-assistant.js instead of the placeholder.'
        ));
        return;
      }
      const waiting = addMessage(messages, 'assistant', tr('لحظة، بفهم طلبك…', 'Thinking…'));
      setBusy(true, send, input);
      try {
        const response = await fetch(localApiKey ? CODECRAFT_URL : endpoint, {
          method: 'POST',
          headers: localApiKey
            ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localApiKey }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify(localApiKey
            ? { model: CODECRAFT_MODEL, messages: [{ role: 'user', content: message }], max_tokens: 500, stream: false }
            : { message, locale: locale() })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || data.message || 'request_failed');
        const reply = localApiKey ? data.choices?.[0]?.message?.content : data.reply;
        waiting.textContent = String(reply || tr('لم يصل رد واضح من المساعد.', 'The assistant returned no clear response.'));
      } catch (error) {
        waiting.textContent = tr(
          'تعذر الاتصال بالخادم. تأكد من نشره وضبط عنوان الموقع المسموح به، ثم حاول مرة أخرى.',
          'Could not reach the backend. Check deployment and the allowed website origin, then try again.'
        );
        console.warn('[SPAssistant] request failed:', error && error.message);
      } finally {
        setBusy(false, send, input);
        input.focus();
      }
    });

    if (global.SPi18n && global.SPi18n.subscribe) {
      global.SPi18n.subscribe(() => {
        // Keep the current conversation intact; update direction for the locale.
        panel.dir = isAr() ? 'rtl' : 'ltr';
        input.placeholder = tr('اكتب المهمة هنا…', 'Write your task here…');
      });
    }
    panel.dir = isAr() ? 'rtl' : 'ltr';
    console.log('[SPAssistant] UI ready; secure backend must be deployed separately.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.SPAssistant = { init, getEndpoint };
})(window);
