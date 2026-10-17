/* ShiftPro NOVA assistant — local-first command router with optional API grounding.
 *
 * Architecture:
 *   1. User message → SPAssistantRouter.detectIntent (pure function).
 *   2. If local/law intent → execute via router (calls real SP* functions).
 *      Consequential ops trigger a confirm dialog before execution.
 *   3. If "explain more" / "simplify" intent → CodeCraft API fallback with a
 *      STRICT system prompt that grounds the model in the previously returned
 *      local context (e.g. the matched labor-law article). The model is told
 *      NOT to invent external facts; if context is missing, it must say so.
 *   4. If unsupported → graceful help message.
 *
 * Both modes (local + API) are active simultaneously. Local commands work
 * with zero configuration. The API fallback only fires when the user
 * explicitly asks for more explanation AND a CodeCraft API key is configured
 * (see Settings → AI Setup).
 *
 * No eval, no dynamic JS, no unsafe DOM manipulation. Every side-effect goes
 * through the existing SP* public functions or the dedicated DOM elements
 * already wired by the app.
 */
(function (global) {
  'use strict';

  // ---------- Config / storage keys ----------
  const LOCAL_KEY = 'shiftpro_codecraft_api_key';
  const WORKER_URL_KEY = 'shiftpro_ai_endpoint';
  const CONVERSATION_KEY = 'shiftpro_ai_last_context';
  const CODECRAFT_URL = 'https://codecraftapi.com/v1/chat/completions';
  const CODECRAFT_MODEL = 'claude-opus-4.8';
  const MAX_MESSAGE = 2000;
  const MAX_HISTORY = 4;

  let busy = false, nudgeTimer = null, nudgeIndex = 0, voiceReplies = false, recognition = null;
  // last local context — used to ground the API fallback
  let lastLocalContext = '';
  // recent conversation for the API system prompt
  let recentTurns = [];

  const locale = () => (global.SPi18n && global.SPi18n.getLocale) ? global.SPi18n.getLocale() : 'ar';
  const isAr = () => locale() !== 'en';
  const tr = (ar, en) => isAr() ? ar : en;

  function workerName() {
    const doc = (typeof document !== 'undefined') ? document : null;
    const el = doc && (doc.getElementById('workerName') || doc.getElementById('heroName'));
    const name = (el && el.textContent || '').trim();
    return (!name || name === '—') ? tr('صديقي', 'there') : name;
  }

  function getLocalApiKey() {
    try { return (localStorage.getItem(LOCAL_KEY) || '').trim(); } catch (_) { return ''; }
  }
  function setLocalApiKey(v) {
    try { localStorage.setItem(LOCAL_KEY, v || ''); } catch (_) {}
  }
  function getWorkerUrl() {
    try { return (localStorage.getItem(WORKER_URL_KEY) || '').trim(); } catch (_) { return ''; }
  }
  function setWorkerUrl(v) {
    try { localStorage.setItem(WORKER_URL_KEY, v || ''); } catch (_) {}
  }

  // ---------- DOM helpers ----------
  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function speakText(text) {
    if (!voiceReplies || !global.speechSynthesis || !global.SpeechSynthesisUtterance) return;
    try {
      global.speechSynthesis.cancel();
      const utterance = new global.SpeechSynthesisUtterance(String(text).slice(0, 1800));
      utterance.lang = isAr() ? 'ar-EG' : 'en-US';
      utterance.rate = 1;
      global.speechSynthesis.speak(utterance);
    } catch (_) {}
  }
  function addMessage(list, role, text) {
    const row = make('div', 'sp-ai-message ' + (role === 'user' ? 'is-user' : 'is-assistant'), text);
    row.setAttribute('role', 'listitem');
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    if (role !== 'user') speakText(text);
    return row;
  }
  function setBusy(value, send, input) {
    busy = value;
    send.disabled = value;
    input.disabled = value;
    send.textContent = value ? '…' : tr('إرسال', 'Send');
  }
  function openPanel(panel, input) {
    panel.hidden = false;
    panel.classList.add('is-open');
    input.focus();
  }
  function closePanel(panel, launcher) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    if (launcher) launcher.focus();
  }

  // ---------- Confirmation dialog (uses SPUtils.confirmDialog if available) ----------
  function askConfirm(message) {
    if (global.SPUtils && typeof global.SPUtils.confirmDialog === 'function') {
      // SPUtils.confirmDialog is async; but we want a synchronous UX here,
      // so fall back to window.confirm for the assistant path.
      try { return global.confirm(message); } catch (_) { return false; }
    }
    try { return global.confirm(message); } catch (_) { return false; }
  }

  // ---------- API fallback (CodeCraft direct OR worker) ----------
  function buildSystemPrompt() {
    // The system prompt is grounded in the user's app context. The model is
    // instructed to NEVER invent external facts, especially for legal
    // questions — it may only restate or simplify the provided context.
    const ctxSummary = lastLocalContext
      ? ('The user just received this content from the app:\n---\n' + lastLocalContext.slice(0, 2500) + '\n---\n')
      : '';
    const history = recentTurns.slice(-MAX_HISTORY).map(t =>
      (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.text
    ).join('\n');
    return [
      'You are NOVA, the in-app assistant for ShiftPro — a shift, attendance, payroll, and wallet PWA for Egyptian workers.',
      'Respond in the user\'s selected language (Arabic in an Egyptian-friendly clear tone, or English).',
      'CRITICAL RULE — do not bring in external facts:',
      '1. For labor-law questions, you may ONLY restate, simplify, or explain the EXACT text the user received from the app (provided in the context block below).',
      '2. If the user asks about a labor-law matter you do not have in the context, refuse politely and tell them to ask the app: e.g., "دوّر على المادة 41" or "search article 41".',
      '3. For payroll, wallet, or attendance numbers, you may ONLY use the exact figures provided in the context block. Never invent balances, salaries, or hours.',
      '4. If no relevant context is provided, say you do not have that information in the app and suggest the user run a local command (e.g., "احسب راتبي").',
      '5. Keep answers short and clear. Simplify legal text using plain words. Use bullet points when helpful.',
      '6. Never request passwords, API keys, PINs, or sensitive data.',
      ctxSummary,
      history ? ('Recent conversation:\n' + history) : ''
    ].filter(Boolean).join('\n');
  }

  async function callApi(userMessage) {
    const key = getLocalApiKey();
    const workerUrl = getWorkerUrl();
    const useWorker = !key && workerUrl && !workerUrl.includes('YOUR-WORKER');
    if (!key && !useWorker) {
      return { ok: false, error: 'no-config', reply: tr(
        'الخدمة الاختيارية مش مفعّلة. الوظائف المحلية شغّالة بدون API. لتفعيل الشرح المعمّق، افتح الإعدادات → مساعد ذكي وأدخل مفتاح CodeCraft.',
        'Optional API not configured. Local functions work without an API. To enable deeper explanations, open Settings → AI Setup and enter a CodeCraft key.'
      ) };
    }

    recentTurns.push({ role: 'user', text: userMessage });
    if (recentTurns.length > MAX_HISTORY * 2) recentTurns = recentTurns.slice(-MAX_HISTORY * 2);

    const body = key
      ? { model: CODECRAFT_MODEL, messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userMessage }
        ], max_tokens: 600, stream: false }
      : { message: userMessage, locale: locale(), context: lastLocalContext || '' };

    try {
      const response = await fetch(key ? CODECRAFT_URL : workerUrl, {
        method: 'POST',
        headers: key
          ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: 'http-' + response.status, reply: tr(
          'تعذّر الوصول للخدمة الآن. حاول تاني بعدين — الوظائف المحلية لسه شغّالة.',
          'Could not reach the service right now. Try again later — local functions still work.'
        ) };
      }
      const reply = key ? (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) : data.reply;
      const text = String(reply || '').trim();
      if (!text) {
        return { ok: false, error: 'empty', reply: tr('لم يصل رد واضح من المساعد.', 'The assistant returned no clear response.') };
      }
      recentTurns.push({ role: 'assistant', text: text });
      return { ok: true, reply: text };
    } catch (e) {
      console.warn('[SPAssistant] API call failed:', e && e.message);
      return { ok: false, error: 'network', reply: tr(
        'تعذّر الاتصال بالخدمة الاختيارية. الوظائف المحلية لسه شغّالة بدون API.',
        'The optional service could not be reached. Local functions remain available without an API.'
      ) };
    }
  }

  // ---------- Router context (window + document, same globals) ----------
  function routerCtx() {
    return global; // router reads SP* + __LAW__ off window
  }

  // ---------- Main message handler ----------
  async function processMessage(message, messages) {
    const ctx = routerCtx();
    const intent = (global.SPAssistantRouter && global.SPAssistantRouter.detectIntent)
      ? global.SPAssistantRouter.detectIntent(message, ctx)
      : { kind: 'unsupported', intent: 'unknown', params: {}, needsConfirm: false, missing: [] };

    // 1) Law RAG: runs locally using window.__LAW__
    if (intent.kind === 'law' || intent.intent === 'law_search') {
      const res = global.SPAssistantRouter.execute('law_search', { raw: message }, ctx, false);
      if (res && res.contextForApi) {
        lastLocalContext = res.contextForApi; // ground future "explain more" calls
        try { localStorage.setItem(CONVERSATION_KEY, lastLocalContext); } catch (_) {}
      }
      return res.reply;
    }

    // 2) Local intents
    if (intent.kind === 'local') {
      // Missing parameters: ask the user
      if (intent.missing && intent.missing.length) {
        const m = intent.missing[0];
        if (m === 'date') return tr('حدد التاريخ — مثلاً: «افتح تفاصيل يوم 12 يناير».', 'Please specify a date — e.g., "open day 12 January".');
        if (m === 'amount') return tr('حدد مبلغ المعاملة.', 'Please specify the amount.');
        return tr('نقص بيانات: ', 'Missing data: ') + m;
      }
      // Confirmation needed for consequential ops
      let confirmed = !intent.needsConfirm;
      if (intent.needsConfirm) {
        const promptMsg = tr(
          'هذه عملية حساسة («' + intent.intent + '»). تأكيد التنفيذ؟',
          'This is a consequential action ("' + intent.intent + '"). Confirm?'
        );
        confirmed = askConfirm(promptMsg);
        if (!confirmed) return tr('تمام، ألغيت العملية.', 'Okay, the action was cancelled.');
      }
      const res = global.SPAssistantRouter.execute(intent.intent, Object.assign({}, intent.params, { raw: message, missing: intent.missing }), ctx, confirmed);
      if (res && res.contextForApi) {
        lastLocalContext = res.contextForApi;
        try { localStorage.setItem(CONVERSATION_KEY, lastLocalContext); } catch (_) {}
      }
      return (res && res.reply) ? res.reply : tr('تم.', 'Done.');
    }

    // 3) "Explain more" / simplify → API fallback grounded in lastLocalContext
    if (intent.kind === 'api' || intent.needsApi) {
      if (!lastLocalContext) {
        return tr(
          'محتاج موضوع أول. اسأل عن مادة قانون أو احسب راتبك الأول، وبعدها اكتب «اشرح اكتر» علشان أبسطه لي.',
          'Please ask about something first (e.g. search a labor-law article or compute your salary), then type "explain more" to simplify it.'
        );
      }
      const r = await callApi(message);
      return r.reply;
    }

    // 4) Unknown / unsupported
    return tr(
      'مش قادر أفهم طلبك ده لسه. اكتب «مساعدة» علشان تشوف اللي اقدر أعمله.',
      'I don\'t understand that request yet. Type "help" to see what I can do.'
    );
  }

  // ---------- UI initialization ----------
  function init() {
    if (document.getElementById('spAiLauncher')) return;
    // Restore last context so the user can keep asking "explain more" after a reload.
    try { lastLocalContext = localStorage.getItem(CONVERSATION_KEY) || ''; } catch (_) {}

    const launcher = make('button', 'sp-ai-launcher');
    launcher.id = 'spAiLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', tr('افتح نوفا مساعد ShiftPro', 'Open NOVA, the ShiftPro assistant'));
    launcher.title = tr('نوفا — مساعد ShiftPro', 'NOVA — ShiftPro assistant');
    launcher.innerHTML = '<svg class="sp-ai-robot" viewBox="0 0 64 64" aria-hidden="true"><path class="robot-antenna" d="M32 8v7"/><circle cx="32" cy="6" r="3"/><rect x="11" y="17" width="42" height="34" rx="12"/><path class="robot-ear" d="M7 29v10m50-10v10"/><rect class="robot-face" x="17" y="23" width="30" height="20" rx="7"/><circle class="robot-eye" cx="25" cy="32" r="3"/><circle class="robot-eye" cx="39" cy="32" r="3"/><path class="robot-mouth" d="M25 38q7 5 14 0"/><path class="robot-body" d="M21 52v5m22-5v5"/></svg><span class="sp-ai-online"></span>';
    const bubble = make('button', 'sp-ai-nudge', tr('هل تحتاج مساعدة يا ' + workerName() + '؟', 'Need any help, ' + workerName() + '?'));
    bubble.type = 'button'; bubble.hidden = true;
    bubble.setAttribute('aria-label', tr('افتح نوفا للمساعدة', 'Open NOVA for help'));
    const panel = make('section', 'sp-ai-panel');
    panel.id = 'spAiPanel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'spAiTitle');

    const header = make('div', 'sp-ai-header');
    const titleWrap = make('div', 'sp-ai-title-wrap');
    titleWrap.appendChild(make('strong', '', 'NOVA · نوفا'));
    titleWrap.firstChild.id = 'spAiTitle';
    titleWrap.appendChild(make('small', '', tr('مساعدك الشخصي في ShiftPro', 'Your personal ShiftPro assistant')));
    const close = make('button', 'sp-ai-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('إغلاق', 'Close'));
    const robot = make('div', 'sp-ai-header-robot');
    robot.innerHTML = launcher.innerHTML;
    header.append(robot, titleWrap, close);

    const notice = make('div', 'sp-ai-notice', tr(
      'نوفا شغّال محليًا للأوامر المدعومة بدون API. الشرح المعمّق بيستخدم CodeCraft اختياريًا ومربوط بالنص اللي التطبيق رجّعه لك — مش بيجيب معلومات من بره.',
      'NOVA works locally for supported commands without an API. Deeper explanations use CodeCraft optionally, grounded in the text the app returned to you — it does not bring in outside information.'
    ));
    const messages = make('div', 'sp-ai-messages');
    messages.id = 'spAiMessages';
    messages.setAttribute('role', 'list');
    addMessage(messages, 'assistant', tr(
      'أهلًا يا ' + workerName() + '! أنا نوفا، مساعدك في ShiftPro. اقدر أفتح الأقسام، أحسب راتبك، أعرض المحفظة، أدوّر على مواد قانون العمل، وأعمل نسخ احتياطية. اكتب «مساعدة» علشان تشوف كل اللي اقدر أعمله.',
      'Hi ' + workerName() + '! I\'m NOVA, your ShiftPro assistant. I can open sections, compute salary, show wallet, search labor-law articles, and create backups. Type "help" to see everything I can do.'
    ));

    const examples = make('div', 'sp-ai-examples');
    [
      tr('افتح التقارير', 'Open reports'),
      tr('احسب راتبي', 'Compute my salary'),
      tr('رصيد المحفظة', 'Wallet balance'),
      tr('دوّر على المادة 41', 'Search article 41'),
      tr('سجل حضور', 'Check in')
    ].forEach(example => {
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
    input.placeholder = tr('اكتب لنوفا هتحتاج إيه…', 'Tell NOVA what you need…');
    input.setAttribute('aria-label', input.placeholder);

    const voice = make('button', 'sp-ai-voice', '🎙️');
    voice.type = 'button';
    voice.title = tr('تحدث وسيحوّل نوفا كلامك إلى نص', 'Speak to NOVA');
    voice.setAttribute('aria-label', voice.title);
    const speak = make('button', 'sp-ai-voice', '🔊');
    speak.type = 'button';
    speak.title = tr('تشغيل أو إيقاف الرد الصوتي', 'Toggle spoken replies');
    speak.setAttribute('aria-label', speak.title);
    speak.setAttribute('aria-pressed', 'false');
    const send = make('button', 'sp-ai-send', tr('إرسال', 'Send'));
    send.type = 'submit';
    form.append(input, voice, speak, send);

    speak.addEventListener('click', () => {
      voiceReplies = !voiceReplies;
      speak.textContent = voiceReplies ? '🔈' : '🔊';
      speak.setAttribute('aria-pressed', String(voiceReplies));
      speak.classList.toggle('is-active', voiceReplies);
      if (!voiceReplies && global.speechSynthesis) global.speechSynthesis.cancel();
      else speakText(tr('تم تشغيل الرد الصوتي', 'Spoken replies are now enabled'));
    });

    voice.addEventListener('click', () => {
      const Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!Recognition) {
        addMessage(messages, 'assistant', tr('المتصفح ده مش بيدعم تحويل الكلام لنص. جرّب Chrome المحدث أو اكتب طلبك.', 'Speech recognition is not supported in this browser. Try an updated Chrome browser or type your request.'));
        return;
      }
      if (recognition) {
        try { recognition.stop(); } catch (_) {}
        recognition = null;
        voice.classList.remove('is-listening');
        return;
      }
      recognition = new Recognition();
      recognition.lang = isAr() ? 'ar-EG' : 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      voice.classList.add('is-listening');
      voice.textContent = '⏹️';
      recognition.onresult = event => {
        let transcript = '';
        for (let j = event.resultIndex; j < event.results.length; j++) transcript += event.results[j][0].transcript;
        input.value = transcript;
      };
      recognition.onerror = () => {
        addMessage(messages, 'assistant', tr('ماقدرتش أسمع الكلام بوضوح. اتأكد من إذن الميكروفون وحاول تاني.', 'I could not recognize the speech. Check microphone permission and try again.'));
      };
      recognition.onend = () => {
        recognition = null;
        voice.classList.remove('is-listening');
        voice.textContent = '🎙️';
        input.focus();
      };
      try { recognition.start(); } catch (_) {
        recognition = null;
        voice.classList.remove('is-listening');
        voice.textContent = '🎙️';
      }
    });

    const footer = make('small', 'sp-ai-footer', tr(
      'الأوامر المحلية تعمل بدون API؛ الشرح المعمّق اختياري ويستند لنص التطبيق.',
      'Local actions work without an API; deeper explanations are optional and grounded in app text.'
    ));

    panel.append(header, notice, messages, examples, form, footer);
    document.body.append(launcher, bubble, panel);

    function showNudge() {
      if (panel.hidden && !document.hidden) {
        bubble.textContent = nudgeIndex++ % 2 === 0
          ? tr('هل تحتاج مساعدة يا ' + workerName() + '؟', 'Need any help, ' + workerName() + '?')
          : tr('نوفا هنا لو احتجت أي حاجة', 'NOVA is here if you need anything');
        bubble.hidden = false;
        bubble.classList.add('is-visible');
        global.setTimeout(() => {
          bubble.classList.remove('is-visible');
          global.setTimeout(() => { bubble.hidden = true; }, 350);
        }, 7000);
      }
    }
    launcher.addEventListener('click', () => {
      bubble.hidden = true;
      panel.hidden ? openPanel(panel, input) : closePanel(panel, launcher);
    });
    bubble.addEventListener('click', () => { bubble.hidden = true; openPanel(panel, input); });
    close.addEventListener('click', () => closePanel(panel, launcher));
    nudgeTimer = global.setInterval(showNudge, 60000);

    form.addEventListener('submit', async event => {
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

      // If the message is a pure local/law command, run synchronously.
      // If it routes to the API, show a "thinking…" placeholder.
      const intent = (global.SPAssistantRouter && global.SPAssistantRouter.detectIntent)
        ? global.SPAssistantRouter.detectIntent(message, routerCtx())
        : { kind: 'unsupported' };
      const needsApi = intent.kind === 'api' || intent.needsApi;

      if (needsApi) {
        const waiting = addMessage(messages, 'assistant', tr('لحظة، ببسّط لك الموضوع…', 'Simplifying that for you…'));
        setBusy(true, send, input);
        try {
          const reply = await processMessage(message, messages);
          waiting.textContent = reply || tr('تم.', 'Done.');
        } catch (e) {
          waiting.textContent = tr('حصل خطأ غير متوقع. حاول تاني.', 'An unexpected error occurred. Try again.');
          console.warn('[SPAssistant] process error', e);
        } finally {
          setBusy(false, send, input);
          input.focus();
        }
      } else {
        // Local sync path (still async for safety)
        try {
          const reply = await processMessage(message, messages);
          if (reply) addMessage(messages, 'assistant', reply);
        } catch (e) {
          addMessage(messages, 'assistant', tr('حصل خطأ غير متوقع. حاول تاني.', 'An unexpected error occurred. Try again.'));
          console.warn('[SPAssistant] process error', e);
        }
      }
    });

    if (global.SPi18n && global.SPi18n.subscribe) {
      global.SPi18n.subscribe(() => {
        panel.dir = isAr() ? 'rtl' : 'ltr';
        input.placeholder = tr('اكتب لنوفا هتحتاج إيه…', 'Tell NOVA what you need…');
        bubble.textContent = tr('هل تحتاج مساعدة يا ' + workerName() + '؟', 'Need any help, ' + workerName() + '?');
      });
    }
    panel.dir = isAr() ? 'rtl' : 'ltr';
    console.log('[SPAssistant] NOVA ready (router + optional API).');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.SPAssistant = {
    init,
    getLocalApiKey,
    setLocalApiKey,
    getWorkerUrl,
    setWorkerUrl,
    // Test seam: allows programmatic dispatch without DOM (used in Jest)
    _processMessage: processMessage,
    _setLastContext: function (s) { lastLocalContext = s || ''; }
  };
})(typeof window !== 'undefined' ? window : this);
