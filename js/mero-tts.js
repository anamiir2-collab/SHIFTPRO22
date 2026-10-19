/* Mero voice playback — optional local neural speech for the Mero assistant.
 *
 * Privacy model:
 *   - Assistant reply text is sent ONLY to the user's own local Piper service
 *     at http://127.0.0.1:8765 (loopback). No cloud TTS, no API keys.
 *   - The browser "Web Speech" fallback runs on the device's installed speech
 *     engine; whether that touches platform services depends on the OS/browser,
 *     so the UI always labels it explicitly and "local only" disables it.
 *   - Nothing about the conversation is logged to the console.
 *
 * Integration model:
 *   - Speech is driven by the "mero:assistant-message" CustomEvent dispatched
 *     by js/ai-assistant.js when it renders a new assistant reply. This module
 *     never watches the DOM and never re-parses old messages, so historical or
 *     user messages are never spoken.
 *   - Each message id is spoken at most once; replay is explicit (user button).
 */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'shiftpro_mero_tts_v2';
  var LEGACY_KEY = 'shiftpro_mero_tts_v1';
  var LOCAL_ENDPOINT = 'http://127.0.0.1:8765';
  var MAX_CHUNK = 700;          // chars per synthesis chunk (under server MAX_TEXT)
  var SPEAKABLE_MAX = 4000;     // total reply length accepted for speech
  var SPOKEN_IDS_MAX = 200;     // dedupe memory bound

  var ENGINES = ['auto', 'local', 'browser'];
  var LANG_PREFS = ['auto', 'ar', 'en'];

  var DEFAULTS = {
    enabled: false,     // master voice switch (muted by default)
    autoSpeak: true,    // speak new assistant replies automatically
    engine: 'auto',     // auto | local | browser
    langPref: 'auto',   // auto | ar | en
    voiceAr: '',        // preferred installed voice id for Arabic
    voiceEn: '',        // preferred installed voice id for English
    browserVoice: '',   // preferred Web-Speech voice name (fallback engine)
    speed: 1,           // 0.6 .. 1.5
    pitch: 1            // 0.5 .. 1.5 (Web Speech only; Piper has no pitch)
  };

  /* ------------------------------------------------------------------ *
   * Pure helpers — no DOM, no fetch. Exposed as MeroTTS._test for Jest. *
   * ------------------------------------------------------------------ */
  function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return Math.round(n * 100) / 100;
  }

  function sanitizeSettings(raw) {
    var src = (raw && typeof raw === 'object') ? raw : {};
    var out = {
      enabled: src.enabled === true,
      autoSpeak: src.autoSpeak === false ? false : DEFAULTS.autoSpeak,
      engine: ENGINES.indexOf(src.engine) >= 0 ? src.engine : DEFAULTS.engine,
      langPref: LANG_PREFS.indexOf(src.langPref) >= 0 ? src.langPref : DEFAULTS.langPref,
      voiceAr: typeof src.voiceAr === 'string' ? src.voiceAr.slice(0, 120) : '',
      voiceEn: typeof src.voiceEn === 'string' ? src.voiceEn.slice(0, 120) : '',
      browserVoice: typeof src.browserVoice === 'string' ? src.browserVoice.slice(0, 120) : '',
      speed: clampNumber(src.speed, 0.6, 1.5, DEFAULTS.speed),
      pitch: clampNumber(src.pitch, 0.5, 1.5, DEFAULTS.pitch)
    };
    return out;
  }

  function migrateLegacy(raw) {
    var src = (raw && typeof raw === 'object') ? raw : {};
    var migrated = {
      enabled: src.enabled === true,
      autoSpeak: DEFAULTS.autoSpeak,
      engine: ENGINES.indexOf(src.engine) >= 0 ? src.engine : DEFAULTS.engine,
      langPref: DEFAULTS.langPref,
      voiceAr: '', voiceEn: '', browserVoice: '',
      speed: clampNumber(src.speed, 0.6, 1.5, DEFAULTS.speed),
      pitch: clampNumber(src.pitch, 0.5, 1.5, DEFAULTS.pitch)
    };
    var legacyVoice = typeof src.voice === 'string' ? src.voice : '';
    if (/^ar[-_]/i.test(legacyVoice)) migrated.voiceAr = legacyVoice.slice(0, 120);
    else if (legacyVoice) migrated.voiceEn = legacyVoice.slice(0, 120);
    return sanitizeSettings(migrated);
  }

  /** Strip markup/emoji/URLs so Mero reads content, not interface noise. */
  function normalizeSpeechText(raw) {
    var text = String(raw == null ? '' : raw);
    text = text.replace(/```[\s\S]*?(?:```|$)/g, ' ');       // fenced code blocks
    text = text.replace(/`([^`]*)`/g, '$1');                 // inline code -> content
    text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');   // [label](url) -> label
    text = text.replace(/https?:\/\/\S+/gi, ' ');            // bare URLs dropped
    text = text.replace(/<[^>]+>/g, ' ');                    // html tags dropped
    text = text.replace(/[#*_>|~`^]+/g, ' ');                // markdown markers
    text = text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' '); // emoji / astral
    text = text.replace(/[\u2190-\u21FF\u2600-\u27BF\uFE0F]/g, ' '); // arrows, symbols
    text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ''); // bidi/zero-width
    text = text.replace(/^[\s\-–—•▪·*]+/gm, ' ');            // list bullets at line starts
    text = text.replace(/\s+/g, ' ').trim();
    return text.slice(0, SPEAKABLE_MAX);
  }

  /** 'ar' when the reply is Arabic-dominant (Mero's primary language). */
  function detectSpeechLanguage(text) {
    var value = String(text || '');
    var arabic = 0, latin = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code >= 0x0600 && code <= 0x06FF) arabic++;
      else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) latin++;
    }
    if (arabic + latin === 0) return 'ar'; // numbers/punctuation only -> default voice
    return (arabic / (arabic + latin)) >= 0.25 ? 'ar' : 'en';
  }

  /** Sentence-bounded chunks; nothing is dropped (join equals input). */
  function splitIntoChunks(text, maxLen) {
    var limit = Math.max(80, maxLen || MAX_CHUNK);
    var value = String(text || '').trim();
    if (!value) return [];
    var sentences = value.match(/[^.!؟?؛;\n…]+[.!؟?؛;\n…]*/g) || [value];
    var chunks = [], current = '';
    var pushCurrent = function () {
      var piece = current.trim();
      if (piece) chunks.push(piece);
      current = '';
    };
    sentences.forEach(function (sentence) {
      var trimmed = sentence.trim();
      if (!trimmed) return;
      while (trimmed.length > limit) {
        // A single huge sentence: split on the last space inside the limit.
        var window = trimmed.slice(0, limit + 1);
        var cut = window.lastIndexOf(' ');
        if (cut < limit * 0.5) cut = limit;
        pushCurrent(); // flush anything pending first to keep order
        chunks.push(trimmed.slice(0, cut).trim());
        trimmed = trimmed.slice(cut).trim();
      }
      if (!trimmed) return;
      if ((current + ' ' + trimmed).trim().length > limit) pushCurrent();
      current = (current ? current + ' ' : '') + trimmed;
    });
    pushCurrent();
    return chunks.filter(function (chunk) { return chunk.length > 0; });
  }

  /** Choose an installed voice for a language; never guesses across languages. */
  function pickVoiceForLanguage(lang, voices, prefAr, prefEn) {
    var list = Array.isArray(voices) ? voices : [];
    var preferredId = lang === 'ar' ? prefAr : prefEn;
    if (preferredId) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === preferredId) return list[i];
      }
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j] && list[j].language && list[j].language.family === lang) return list[j];
    }
    return null;
  }

  /* ----------------------------- state ----------------------------- */
  var prefs = loadPrefs();
  var dom = {};                 // element references
  var localVoices = [];         // installed voices reported by /voices
  var healthState = 'unknown';  // 'up' | 'up-no-models' | 'down' | 'unknown'
  var speaking = false;
  var generation = 0;           // Stop token: every async step re-validates it
  var requestController = null; // AbortController for the active /tts request
  var voicesController = null;  // AbortController for /voices refreshes
  var currentAudio = null;
  var objectUrl = null;
  var spokenIds = [];           // message ids already spoken (bounded FIFO)
  var lastReply = null;         // { id, text } for the replay button
  var initialized = false;

  function loadPrefs() {
    try {
      var stored = global.localStorage ? global.localStorage.getItem(SETTINGS_KEY) : null;
      if (stored) return sanitizeSettings(JSON.parse(stored));
      var legacy = global.localStorage ? global.localStorage.getItem(LEGACY_KEY) : null;
      if (legacy) {
        var migrated = migrateLegacy(JSON.parse(legacy));
        try { global.localStorage.removeItem(LEGACY_KEY); } catch (_) {}
        return migrated;
      }
    } catch (_) {}
    return sanitizeSettings(null);
  }

  function savePrefs() {
    try { global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs)); } catch (_) {}
  }

  function locale() {
    return (global.SPi18n && global.SPi18n.getLocale) ? global.SPi18n.getLocale() : 'ar';
  }
  function tr(ar, en) { return locale() === 'en' ? en : ar; }

  function makeId() { return 'mero-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  function markSpoken(id) {
    if (!id) return;
    spokenIds.push(id);
    if (spokenIds.length > SPOKEN_IDS_MAX) spokenIds.splice(0, spokenIds.length - SPOKEN_IDS_MAX);
  }
  function wasSpoken(id) { return id ? spokenIds.indexOf(id) >= 0 : false; }

  /* ------------------------- status / notices ----------------------- */
  var NOTICES = {
    muted:        ['الصوت مكتوم. فعّل الصوت من الزر أعلاه لسماع ردود ميرو.', 'Voice is muted. Enable voice above to hear Mero.'],
    engineReady:  ['المحرك الصوتي العصبي المحلي جاهز.', 'The local neural voice engine is ready.'],
    noModels:     ['الخدمة المحلية تعمل لكن لا يوجد نموذج صوتي مثبت. ثبّت نموذجًا عربيًا من مجلد local-tts عبر download-models.py.', 'The local service runs but no voice model is installed. Install one (e.g. Arabic) via download-models.py in local-tts.'],
    engineDownLocal: ['الخدمة المحلية غير متاحة، ووضع "محلي فقط" لن يستخدم بديلًا. شغّل start-tts.bat / start-tts.sh ثم أعد المحاولة.', 'The local service is unavailable and "local only" mode will not fall back. Start start-tts.bat / start-tts.sh and retry.'],
    engineDownAuto:  ['الخدمة المحلية غير متاحة؛ سيُستخدم صوت النظام الاحتياطي عند التشغيل إن كان متوفرًا.', 'Local service unavailable; the system voice fallback will be used when available.'],
    engineBrowser:   ['تنبيه خصوصية: صوت النظام (Web Speech) قد يعتمد على خدمات النظام/المتصفح ولا يُضمن عمله دون إنترنت. للخصوصية الصارمة اختر "محلي فقط".', 'Privacy notice: the system voice (Web Speech) may rely on OS/browser services and is not guaranteed offline. For strict privacy choose "local only".'],
    browserNoVoiceAr:['متصفحك لا يوفر صوتًا عربيًا مثبتًا، لذلك لن تُقرأ الردود العربية بصوت النظام. ثبّت نموذج Piper العربي للحصول على صوت عربي طبيعي.', 'Your browser has no installed Arabic voice, so Arabic replies will not be spoken by the system engine. Install the Piper Arabic model for natural Arabic speech.'],
    browserNoVoiceEn:['متصفحك لا يوفر صوتًا إنجليزيًا مثبتًا لهذه الرسالة.', 'Your browser has no installed English voice for this message.'],
    invalidAudio: ['تعذر تشغيل الصوت الناتج من الخدمة المحلية.', 'The audio returned by the local service could not be played.'],
    serverError:  ['فشل توليد الصوت محليًا. تأكد من تثبيت النموذج الصوتي ثم أعد المحاولة.', 'Local speech generation failed. Verify the installed voice model and retry.'],
    cacheCleared: ['تم مسح ذاكرة الصوت المؤقتة على جهازك.', 'The local audio cache was cleared.'],
    cacheDown:    ['الخدمة المحلية غير متاحة؛ لا توجد ذاكرة صوت لمسحها.', 'Local service unavailable; there is no audio cache to clear.'],
    busy:         ['الخدمة مشغولة حاليًا؛ حاول بعد لحظات.', 'The service is busy; try again shortly.'],
    noFallback:   ['لا يوجد محرك نطق متاح الآن: الخدمة المحلية متوقفة وهذا المتصفح لا يوفر صوت نظام.', 'No speech engine is available right now: the local service is stopped and this browser has no system voice.']
  };
  var noticeKind = {
    engineReady: 'ok', noModels: 'warn', engineDownLocal: 'error', engineDownAuto: 'warn',
    engineBrowser: 'warn', browserNoVoiceAr: 'warn', browserNoVoiceEn: 'warn',
    invalidAudio: 'error', serverError: 'error', cacheDown: 'warn', busy: 'warn', noFallback: 'error'
  };

  function setNotice(key) {
    var entry = NOTICES[key];
    if (!entry || !dom.notice) return;
    dom.notice.textContent = tr(entry[0], entry[1]);
    dom.notice.dataset.kind = noticeKind[key] || 'info';
  }

  function updateStatus() {
    if (dom.status) {
      var text;
      if (!prefs.enabled) text = tr('مكتوم', 'Muted');
      else if (speaking) text = tr('جارٍ النطق…', 'Speaking…');
      else text = tr('الصوت جاهز', 'Voice ready');
      dom.status.textContent = text;
      dom.status.dataset.speaking = String(speaking && prefs.enabled);
      dom.status.dataset.muted = String(!prefs.enabled);
    }
    if (dom.controls) {
      dom.controls.classList.toggle('is-speaking', speaking && prefs.enabled);
      dom.controls.classList.toggle('is-muted', !prefs.enabled);
    }
    if (dom.stop) dom.stop.disabled = !speaking;
    if (dom.replay) dom.replay.disabled = !lastReply;
    if (dom.toggle) {
      dom.toggle.textContent = prefs.enabled ? tr('كتم الصوت', 'Mute voice') : tr('تشغيل الصوت', 'Enable voice');
      dom.toggle.setAttribute('aria-pressed', String(prefs.enabled));
    }
  }

  /* --------------------------- stop pipeline ------------------------ */
  function stop() {
    generation++;                                  // invalidates every pending step
    if (requestController) { try { requestController.abort(); } catch (_) {} requestController = null; }
    if (currentAudio) {
      try { currentAudio.pause(); } catch (_) {}
      currentAudio.removeAttribute('src');          // release decoder
      try { currentAudio.load(); } catch (_) {}
      currentAudio = null;
    }
    if (objectUrl) { try { global.URL.revokeObjectURL(objectUrl); } catch (_) {} objectUrl = null; }
    if ('speechSynthesis' in global) { try { global.speechSynthesis.cancel(); } catch (_) {} }
    speaking = false;
    updateStatus();
  }

  /* ------------------------ browser fallback ------------------------ */
  function browserVoices() {
    if (!('speechSynthesis' in global) || typeof global.SpeechSynthesisUtterance !== 'function') return [];
    try { return global.speechSynthesis.getVoices() || []; } catch (_) { return []; }
  }

  function browserVoiceFor(lang) {
    var voices = browserVoices();
    if (prefs.browserVoice) {
      for (var i = 0; i < voices.length; i++) {
        var vLang = String(voices[i].lang || '').toLowerCase().replace('_', '-');
        if (voices[i].name === prefs.browserVoice && vLang.indexOf(lang) === 0) return voices[i];
      }
    }
    for (var j = 0; j < voices.length; j++) {
      if (String(voices[j].lang || '').toLowerCase().replace('_', '-').indexOf(lang) === 0) return voices[j];
    }
    return null;
  }

  function browserSpeakOne(chunk, lang, token) {
    return new Promise(function (resolve) {
      if (token !== generation) return resolve(false);
      if (!('speechSynthesis' in global) || typeof global.SpeechSynthesisUtterance !== 'function') {
        setNotice('noFallback');
        return resolve(false);
      }
      var voice = browserVoiceFor(lang);
      if (!voice) {
        setNotice(lang === 'ar' ? 'browserNoVoiceAr' : 'browserNoVoiceEn');
        return resolve(false);
      }
      setNotice('engineBrowser'); // visible fallback explanation, every time
      var utterance = new global.SpeechSynthesisUtterance(chunk);
      utterance.voice = voice;
      utterance.lang = voice.lang || (lang === 'ar' ? 'ar' : 'en-US');
      utterance.rate = clampNumber(prefs.speed, 0.6, 1.5, 1);
      utterance.pitch = clampNumber(prefs.pitch, 0.5, 1.5, 1);
      utterance.onstart = function () { if (token === generation) { speaking = true; updateStatus(); } };
      utterance.onend = function () { speaking = false; updateStatus(); resolve(true); };
      utterance.onerror = function () { speaking = false; updateStatus(); resolve(false); };
      try {
        global.speechSynthesis.speak(utterance);
      } catch (_) {
        speaking = false; updateStatus(); resolve(false);
      }
    });
  }

  /* --------------------------- local engine ------------------------- */
  function safeErrorDetail(response) {
    // Server details never contain the request text, but we only keep a short
    // generic slice anyway.
    try {
      return String((response && response.status) || 'error');
    } catch (_) { return 'error'; }
  }

  function playAudioElement(audio, token) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('pause', onPaused);
        if (ok) resolve(true); else reject(new Error('audio-error'));
      };
      var onEnded = function () { speaking = false; updateStatus(); finish(true); };
      var onError = function () { finish(false); };
      var onPaused = function () { if (!settled && token !== generation) finish(true); };
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.addEventListener('pause', onPaused);
      audio.play().catch(function () { finish(false); });
    });
  }

  async function localSpeakOne(chunk, lang, token) {
    var voice = pickVoiceForLanguage(lang, localVoices, prefs.voiceAr, prefs.voiceEn);
    if (!voice) {
      // A genuinely installed model is required; never fake one.
      setNotice('noModels');
      return false;
    }
    requestController = new AbortController();
    var controller = requestController;
    var response;
    try {
      response = await fetch(LOCAL_ENDPOINT + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, voice: voice.id, speed: prefs.speed }),
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal
      });
    } catch (_) {
      if (token !== generation) return false;
      requestController = null;
      throw new Error('local-unavailable');
    }
    if (token !== generation) return false;
    requestController = null;
    if (!response.ok) {
      if (response.status === 429) setNotice('busy');
      else if (response.status === 503 || response.status === 504) setNotice('noModels');
      else setNotice('serverError');
      throw new Error('local-http-' + safeErrorDetail(response));
    }
    var blob = await response.blob();
    if (token !== generation) return false;
    if (!blob || (blob.type && blob.type.indexOf('audio') !== 0) || blob.size < 100) {
      setNotice('invalidAudio');
      throw new Error('invalid-audio');
    }
    if (objectUrl) { try { global.URL.revokeObjectURL(objectUrl); } catch (_) {} }
    objectUrl = global.URL.createObjectURL(blob);
    currentAudio = new global.Audio(objectUrl);
    try {
      await playAudioElement(currentAudio, token);
      return true;
    } finally {
      if (token === generation) { currentAudio = null; }
    }
  }

  /* ------------------------- playback queue ------------------------- */
  async function speakText(text, options) {
    var opts = options || {};
    var token = generation; // caller has already bumped generation via stop()
    var lang = prefs.langPref === 'auto' || prefs.langPref == null
      ? detectSpeechLanguage(text)
      : prefs.langPref;
    var chunks = splitIntoChunks(text, MAX_CHUNK);
    if (!chunks.length) return;
    speaking = true;
    updateStatus();
    for (var i = 0; i < chunks.length; i++) {
      if (token !== generation) return; // Stop pressed or a newer reply arrived
      if (prefs.engine === 'browser') {
        var spoke = await browserSpeakOne(chunks[i], lang, token);
        if (token !== generation) return;
        if (!spoke) break;
      } else {
        var result;
        try {
          result = await localSpeakOne(chunks[i], lang, token);
        } catch (_) {
          result = false;
          if (token !== generation) return;
          if (prefs.engine === 'local') {
            // Local-only mode: never silently switch engines.
            setNotice('engineDownLocal');
            speaking = false;
            updateStatus();
            return;
          }
          setNotice('engineDownAuto');
        }
        if (token !== generation) return;
        if (!result) {
          if (prefs.engine === 'auto') {
            var fellBack = await browserSpeakOne(chunks[i], lang, token);
            if (token !== generation) return;
            if (!fellBack) break;
          } else break;
        }
      }
    }
    speaking = false;
    updateStatus();
  }

  function speak(rawText, options) {
    var opts = options || {};
    if (!prefs.enabled) return;
    var text = normalizeSpeechText(rawText);
    if (!text) return;
    if (opts.messageId && !opts.force && wasSpoken(opts.messageId)) return; // never twice
    markSpoken(opts.messageId || makeId());
    stop();            // cancel anything pending; Stop always wins
    lastReply = { id: opts.messageId || makeId(), text: text };
    speakText(text, opts);
  }

  function replayLast() {
    if (!lastReply) return;
    stop();
    speakText(lastReply.text, {});
  }

  /* --------------------------- voices refresh ----------------------- */
  async function refreshVoices() {
    if (prefs.engine === 'browser') {
      healthState = 'unknown';
      renderVoiceOptions();
      setNotice('engineBrowser');
      updateStatus();
      return;
    }
    if (voicesController) { try { voicesController.abort(); } catch (_) {} }
    voicesController = new AbortController();
    var controller = voicesController;
    var timer = setTimeout(function () { try { controller.abort(); } catch (_) {} }, 4000);
    try {
      var response = await fetch(LOCAL_ENDPOINT + '/voices', {
        cache: 'no-store', mode: 'cors', signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error('voices-http-' + response.status);
      var data = await response.json();
      localVoices = (data && Array.isArray(data.voices)) ? data.voices : [];
      healthState = localVoices.length ? 'up' : 'up-no-models';
      setNotice(localVoices.length ? 'engineReady' : 'noModels');
    } catch (_) {
      clearTimeout(timer);
      localVoices = [];
      healthState = 'down';
      setNotice(prefs.engine === 'local' ? 'engineDownLocal' : 'engineDownAuto');
    }
    renderVoiceOptions();
    updateStatus();
  }

  async function clearServerCache() {
    if (healthState === 'down') { setNotice('cacheDown'); return; }
    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { try { controller.abort(); } catch (_) {} }, 5000);
      var response = await fetch(LOCAL_ENDPOINT + '/cache', {
        method: 'DELETE', cache: 'no-store', mode: 'cors', signal: controller.signal
      });
      clearTimeout(timer);
      setNotice(response && response.ok ? 'cacheCleared' : 'serverError');
    } catch (_) {
      setNotice('cacheDown');
    }
  }

  /* ---------------------------- UI building ------------------------- */
  function make(tag, cls, text) {
    var el = global.document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function renderVoiceOptions() {
    if (!dom.voice) return;
    dom.voice.replaceChildren();
    if (prefs.engine === 'browser') {
      var voices = browserVoices();
      if (!voices.length) {
        dom.voice.appendChild(make('option', '', tr('لا توجد أصوات نظام متاحة', 'No system voices available')));
        dom.voice.disabled = true;
        dom.voice.dataset.source = 'browser';
        return;
      }
      voices.forEach(function (v) {
        var option = make('option', '', v.name + ' (' + v.lang + ')');
        option.value = v.name;
        dom.voice.appendChild(option);
      });
      dom.voice.disabled = false;
      dom.voice.dataset.source = 'browser';
      if (voices.some(function (v) { return v.name === prefs.browserVoice; })) dom.voice.value = prefs.browserVoice;
      else prefs.browserVoice = '';
      return;
    }
    dom.voice.dataset.source = 'local';
    if (!localVoices.length) {
      var emptyLabel = healthState === 'down'
        ? tr('الخدمة المحلية غير متاحة', 'Local service unavailable')
        : tr('لا يوجد نموذج صوتي مثبت', 'No voice model installed');
      dom.voice.appendChild(make('option', '', emptyLabel));
      dom.voice.disabled = true;
      return;
    }
    // Group genuinely installed voices by language family (ar / en / other).
    var groups = { ar: [], en: [], other: [] };
    localVoices.forEach(function (v) {
      var family = v && v.language && v.language.family;
      (family === 'ar' || family === 'en' ? groups[family] : groups.other).push(v);
    });
    var labelFor = function (v) {
      var code = v.language && v.language.code ? v.language.code : '';
      return v.name + (code ? ' · ' + code : '') + (v.quality ? ' (' + v.quality + ')' : '');
    };
    var buildGroup = function (list, arLabel, enLabel) {
      if (!list.length) return;
      var group = make('optgroup');
      group.label = locale() === 'en' ? enLabel : arLabel;
      list.forEach(function (v) {
        var option = make('option', '', labelFor(v));
        option.value = v.id;
        group.appendChild(option);
      });
      dom.voice.appendChild(group);
    };
    buildGroup(groups.ar, 'العربية', 'Arabic');
    buildGroup(groups.en, 'الإنجليزية', 'English');
    buildGroup(groups.other, 'لغات أخرى', 'Other languages');
    dom.voice.disabled = false;
    syncVoiceSelection();
  }

  function syncVoiceSelection() {
    if (!dom.voice || dom.voice.disabled || prefs.engine === 'browser') return;
    var lang = prefs.langPref === 'en' ? 'en' : 'ar';
    var current = lang === 'ar' ? prefs.voiceAr : prefs.voiceEn;
    var has = Array.prototype.some.call(dom.voice.options || [], function (o) { return o.value === current; });
    if (has) { dom.voice.value = current; return; }
    // Remember the first genuinely available voice per language.
    var voice = pickVoiceForLanguage(lang, localVoices, '', '');
    if (voice) {
      if (lang === 'ar') prefs.voiceAr = voice.id; else prefs.voiceEn = voice.id;
      savePrefs();
      dom.voice.value = voice.id;
    }
  }

  function applyPitchAvailability() {
    if (!dom.pitch) return;
    var supported = prefs.engine === 'browser'; // Piper exposes no pitch control
    dom.pitch.disabled = !supported;
    if (dom.pitchLabel) {
      dom.pitchLabel.querySelector('small').textContent = supported
        ? String(prefs.pitch)
        : tr('غير مدعوم محليًا', 'not supported locally');
    }
  }

  function applyLabels() {
    if (!dom.controls) return;
    dom.controls.setAttribute('aria-label', tr('إعدادات صوت ميرو', 'Mero voice settings'));
    updateStatus();
    if (dom.autoLabel) dom.autoLabel.textContent = tr('نطق الردود الجديدة تلقائيًا', 'Speak new replies automatically');
    if (dom.engineLabel) dom.engineLabel.childNodes[0].textContent = tr('المحرك', 'Engine');
    if (dom.voiceLabel) dom.voiceLabel.childNodes[0].textContent = tr('الصوت', 'Voice');
    if (dom.speedLabel) dom.speedLabel.childNodes[0].textContent = tr('سرعة الكلام', 'Speaking speed');
    if (dom.pitchLabel) dom.pitchLabel.childNodes[0].textContent = tr('درجة النبرة', 'Pitch');
    if (dom.cacheButton) dom.cacheButton.textContent = tr('مسح ذاكرة الصوت', 'Clear audio cache');
    var engineOptions = { auto: [tr('محلي مع بديل النظام', 'Local with system fallback'), 0], local: ['Piper — ' + tr('محلي فقط', 'local only'), 1], browser: [tr('صوت النظام (بديل)', 'System voice (fallback)'), 2] };
    Object.keys(engineOptions).forEach(function (key) {
      var entry = engineOptions[key];
      if (dom.engine && dom.engine.options[entry[1]]) dom.engine.options[entry[1]].textContent = entry[0];
    });
    if (dom.lang && dom.lang.options) {
      dom.lang.options[0].textContent = tr('تلقائي حسب الرد', 'Auto per reply');
      dom.lang.options[1].textContent = tr('عربي', 'Arabic');
      dom.lang.options[2].textContent = tr('إنجليزي', 'English');
    }
    renderVoiceOptions();
  }

  function buildControls(panel) {
    var controls = make('section', 'sp-ai-tts');
    controls.id = 'meroTtsControls';
    controls.setAttribute('aria-label', tr('إعدادات صوت ميرو', 'Mero voice settings'));

    var row = make('div', 'sp-ai-tts-row');
    var toggle = make('button', 'sp-ai-tts-button', prefs.enabled ? tr('كتم الصوت', 'Mute voice') : tr('تشغيل الصوت', 'Enable voice'));
    toggle.type = 'button'; toggle.id = 'meroTtsToggle';
    toggle.setAttribute('aria-pressed', String(prefs.enabled));
    var status = make('span', 'sp-ai-tts-status', tr('الصوت جاهز', 'Voice ready'));
    status.id = 'meroTtsStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var stopBtn = make('button', 'sp-ai-tts-button secondary', tr('إيقاف', 'Stop'));
    stopBtn.type = 'button'; stopBtn.id = 'meroTtsStop'; stopBtn.disabled = true;
    stopBtn.setAttribute('aria-label', tr('إيقاف النطق فورًا', 'Stop speaking immediately'));
    var replay = make('button', 'sp-ai-tts-button secondary', tr('أعد آخر رد', 'Replay reply'));
    replay.type = 'button'; replay.id = 'meroTtsReplay'; replay.disabled = true;
    replay.setAttribute('aria-label', tr('إعادة نطق آخر رد من ميرو', 'Replay Mero’s latest reply'));
    row.append(toggle, status, stopBtn, replay);

    var notice = make('p', 'sp-ai-tts-notice', tr('الصوت مكتوم. فعّل الصوت لسماع ردود ميرو.', 'Voice is muted. Enable voice to hear Mero.'));
    notice.id = 'meroTtsNotice';

    var settings = make('div', 'sp-ai-tts-settings');

    var engineLabel = make('label', '', tr('المحرك', 'Engine'));
    var engine = make('select', 'sp-ai-tts-select'); engine.id = 'meroTtsEngine';
    [['auto', tr('محلي مع بديل النظام', 'Local with system fallback')],
     ['local', 'Piper — ' + tr('محلي فقط', 'local only')],
     ['browser', tr('صوت النظام (بديل)', 'System voice (fallback)')]].forEach(function (pair) {
      var option = make('option', '', pair[1]); option.value = pair[0]; engine.appendChild(option);
    });
    engine.value = prefs.engine;
    engineLabel.appendChild(engine);

    var langLabel = make('label', '', tr('لغة الردود', 'Reply language'));
    var lang = make('select', 'sp-ai-tts-select'); lang.id = 'meroTtsLang';
    [['auto', tr('تلقائي حسب الرد', 'Auto per reply')], ['ar', tr('عربي', 'Arabic')], ['en', tr('إنجليزي', 'English')]].forEach(function (pair) {
      var option = make('option', '', pair[1]); option.value = pair[0]; lang.appendChild(option);
    });
    lang.value = prefs.langPref;
    langLabel.appendChild(lang);

    var voiceLabel = make('label', '', tr('الصوت', 'Voice'));
    var voice = make('select', 'sp-ai-tts-select'); voice.id = 'meroTtsVoice';
    voiceLabel.appendChild(voice);

    var autoWrap = make('label', 'sp-ai-tts-check');
    var autoCheck = make('input'); autoCheck.type = 'checkbox'; autoCheck.id = 'meroTtsAutoSpeak';
    autoCheck.checked = prefs.autoSpeak;
    var autoLabel = make('span', '', tr('نطق الردود الجديدة تلقائيًا', 'Speak new replies automatically'));
    autoWrap.append(autoCheck, autoLabel);

    var speedLabel = make('label', '', tr('سرعة الكلام', 'Speaking speed'));
    var speed = make('input', 'sp-ai-tts-range'); speed.type = 'range';
    speed.min = '0.6'; speed.max = '1.5'; speed.step = '0.1'; speed.value = String(prefs.speed);
    speed.setAttribute('aria-label', tr('سرعة الكلام', 'Speaking speed'));
    speedLabel.append(speed, make('small', '', prefs.speed + '×'));

    var pitchLabel = make('label', '', tr('درجة النبرة', 'Pitch'));
    var pitch = make('input', 'sp-ai-tts-range'); pitch.type = 'range';
    pitch.min = '0.5'; pitch.max = '1.5'; pitch.step = '0.1'; pitch.value = String(prefs.pitch);
    pitch.setAttribute('aria-label', tr('درجة النبرة (صوت النظام فقط)', 'Pitch (system voice only)'));
    pitchLabel.append(pitch, make('small', '', String(prefs.pitch)));

    var cacheButton = make('button', 'sp-ai-tts-button secondary sp-ai-tts-small', tr('مسح ذاكرة الصوت', 'Clear audio cache'));
    cacheButton.type = 'button'; cacheButton.id = 'meroTtsCacheClear';

    settings.append(engineLabel, langLabel, voiceLabel, autoWrap, speedLabel, pitchLabel, cacheButton);
    controls.append(row, notice, settings);

    var header = panel.querySelector('.sp-ai-header');
    if (header) header.insertAdjacentElement('afterend', controls);
    else panel.prepend(controls);

    dom = {
      controls: controls, toggle: toggle, status: status, stop: stopBtn, replay: replay,
      notice: notice, engine: engine, engineLabel: engineLabel, lang: lang,
      voice: voice, voiceLabel: voiceLabel, autoCheck: autoCheck, autoLabel: autoLabel,
      speed: speed, speedLabel: speedLabel, pitch: pitch, pitchLabel: pitchLabel,
      cacheButton: cacheButton
    };
  }

  function bindEvents(panel) {
    dom.toggle.addEventListener('click', function () {
      prefs.enabled = !prefs.enabled;
      savePrefs();
      if (!prefs.enabled) { stop(); setNotice('muted'); }
      else { refreshVoices(); }
      updateStatus();
    });
    dom.stop.addEventListener('click', stop);
    dom.replay.addEventListener('click', replayLast);
    dom.engine.addEventListener('change', function () {
      prefs.engine = ENGINES.indexOf(dom.engine.value) >= 0 ? dom.engine.value : 'auto';
      savePrefs();
      applyPitchAvailability();
      refreshVoices();
    });
    dom.lang.addEventListener('change', function () {
      prefs.langPref = LANG_PREFS.indexOf(dom.lang.value) >= 0 ? dom.lang.value : 'auto';
      savePrefs();
      syncVoiceSelection();
    });
    dom.voice.addEventListener('change', function () {
      if (prefs.engine === 'browser') {
        prefs.browserVoice = dom.voice.value.slice(0, 120);
      } else {
        // Store the choice in the bucket of the voice's real language family,
        // so auto-language replies keep using the right per-language voice.
        var selected = dom.voice.value.slice(0, 120);
        var family = '';
        localVoices.forEach(function (v) {
          if (v && v.id === selected && v.language) family = v.language.family;
        });
        if (family === 'en') prefs.voiceEn = selected;
        else prefs.voiceAr = selected;
      }
      savePrefs();
    });
    dom.autoCheck.addEventListener('change', function () {
      prefs.autoSpeak = dom.autoCheck.checked;
      savePrefs();
    });
    dom.speed.addEventListener('input', function () {
      prefs.speed = clampNumber(dom.speed.value, 0.6, 1.5, 1);
      dom.speedLabel.querySelector('small').textContent = prefs.speed + '×';
      savePrefs();
    });
    dom.pitch.addEventListener('input', function () {
      prefs.pitch = clampNumber(dom.pitch.value, 0.5, 1.5, 1);
      if (prefs.engine === 'browser') dom.pitchLabel.querySelector('small').textContent = String(prefs.pitch);
      savePrefs();
    });
    dom.cacheButton.addEventListener('click', function () {
      if (global.confirm && !global.confirm(tr('مسح ملفات الصوت المخزنة مؤقتًا على جهازك؟', 'Clear cached audio files on this device?'))) return;
      clearServerCache();
    });

    // New assistant replies arrive through the assistant's own render path.
    global.document.addEventListener('mero:assistant-message', function (event) {
      var detail = event && event.detail;
      if (!detail || detail.role !== 'assistant' || !detail.text) return;
      lastReply = { id: detail.id || makeId(), text: normalizeSpeechText(detail.text) };
      if (dom.replay) dom.replay.disabled = false;
      if (!prefs.enabled || !prefs.autoSpeak) return;
      speak(lastReply.text, { messageId: lastReply.id });
    });

    // Closing Mero stops speech; Escape closes the panel (existing behavior).
    panel.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('.sp-ai-close')) stop();
    });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') stop();
    });
    global.addEventListener('pagehide', stop);
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible' && prefs.enabled && prefs.engine !== 'browser') {
        refreshVoices(); // self-heal if the user started the service meanwhile
      }
    });
    if ('speechSynthesis' in global && typeof global.speechSynthesis !== 'undefined') {
      try {
        global.speechSynthesis.onvoiceschanged = function () {
          if (prefs.engine === 'browser') renderVoiceOptions();
        };
      } catch (_) {}
    }
    if (global.SPi18n && typeof global.SPi18n.subscribe === 'function') {
      try { global.SPi18n.subscribe(function () { applyLabels(); }); } catch (_) {}
    }
  }

  function init() {
    if (initialized) return;
    var panel = global.document.getElementById('spAiPanel');
    var messages = global.document.getElementById('spAiMessages');
    if (!panel || !messages || global.document.getElementById('meroTtsControls')) return;
    initialized = true;
    buildControls(panel);
    bindEvents(panel);
    applyPitchAvailability();
    renderVoiceOptions();
    setNotice(prefs.enabled ? 'engineDownAuto' : 'muted');
    updateStatus();
    refreshVoices();
  }

  /* Public surface. Pure helpers remain available for Jest via _test. */
  global.MeroTTS = {
    init: init,
    speak: speak,
    stop: stop,
    replayLast: replayLast,
    refreshVoices: refreshVoices,
    clearServerCache: clearServerCache,
    getPreferences: function () { return sanitizeSettings(prefs); },
    isSpeaking: function () { return speaking; },
    _test: {
      sanitizeSettings: sanitizeSettings,
      migrateLegacy: migrateLegacy,
      normalizeSpeechText: normalizeSpeechText,
      detectSpeechLanguage: detectSpeechLanguage,
      splitIntoChunks: splitIntoChunks,
      pickVoiceForLanguage: pickVoiceForLanguage
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
    } else {
      setTimeout(init, 0);
    }
  }
})(typeof window !== 'undefined' ? window : this);
