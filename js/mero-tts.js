/* Mero speech controls. All neural TTS requests are loopback-only. */
(function (global) {
  'use strict';
  const KEY = 'shiftpro_mero_tts_v1';
  const ENDPOINT = 'http://127.0.0.1:8765';
  const defaults = { enabled: false, engine: 'auto', voice: 'ar', speed: 1, pitch: 1 };
  let prefs = Object.assign({}, defaults);
  let currentAudio = null;
  let objectUrl = null;
  let speaking = false;
  let fallbackWarned = false;
  let messagesNode = null;

  const tr = (ar, en) => {
    const locale = global.SPi18n && global.SPi18n.getLocale ? global.SPi18n.getLocale() : 'ar';
    return locale === 'en' ? en : ar;
  };
  const readPrefs = () => {
    try { prefs = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  };
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {} };
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  function stop() {
    if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if ('speechSynthesis' in global) global.speechSynthesis.cancel();
    speaking = false;
    updateStatus();
  }
  function updateStatus() {
    const status = document.getElementById('meroTtsStatus');
    if (status) {
      status.textContent = speaking ? tr('جارٍ التحدث…', 'Speaking…') : tr('الصوت متوقف', 'Voice idle');
      status.dataset.speaking = String(speaking);
    }
    const stopBtn = document.getElementById('meroTtsStop');
    if (stopBtn) stopBtn.disabled = !speaking;
  }
  function browserSpeak(text) {
    if (!('speechSynthesis' in global) || typeof global.SpeechSynthesisUtterance !== 'function') {
      showStatus(tr('خدمة Piper غير متاحة ولا يوجد صوت احتياطي في هذا المتصفح.', 'Piper is unavailable and this browser has no speech fallback.'));
      return;
    }
    if (!fallbackWarned) {
      showStatus(tr('تنبيه: يتم استخدام صوت النظام الاحتياطي، وليس الصوت العصبي المحلي.', 'Notice: using the system speech fallback, not local neural voice.'));
      fallbackWarned = true;
    }
    const utterance = new global.SpeechSynthesisUtterance(text);
    utterance.lang = /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en-US';
    utterance.rate = Number(prefs.speed) || 1;
    utterance.pitch = Number(prefs.pitch) || 1;
    const voices = global.speechSynthesis.getVoices();
    const selected = voices.find(v => v.name === prefs.voice) || voices.find(v => v.lang.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0,2)));
    if (selected) utterance.voice = selected;
    utterance.onstart = () => { speaking = true; updateStatus(); };
    utterance.onend = utterance.onerror = () => { speaking = false; updateStatus(); };
    global.speechSynthesis.cancel();
    global.speechSynthesis.speak(utterance);
  }
  function showStatus(text) {
    const status = document.getElementById('meroTtsStatus');
    if (status && text) status.textContent = text;
  }
  async function speak(text) {
    if (!prefs.enabled || !String(text || '').trim()) return;
    stop();
    speaking = true;
    updateStatus();
    const payload = { text: String(text).slice(0, 2000), voice: prefs.voice, speed: Number(prefs.speed) || 1 };
    if (prefs.engine !== 'browser') {
      try {
        const response = await fetch(ENDPOINT + '/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), cache: 'no-store', mode: 'cors'
        });
        if (!response.ok) throw new Error((await response.text()).slice(0, 300));
        const blob = await response.blob();
        if (blob.type && !blob.type.includes('audio')) throw new Error('Invalid audio response');
        objectUrl = URL.createObjectURL(blob);
        currentAudio = new Audio(objectUrl);
        currentAudio.onended = () => { speaking = false; updateStatus(); };
        currentAudio.onerror = () => { speaking = false; updateStatus(); showStatus(tr('تعذر تشغيل ملف الصوت المحلي.', 'Could not play local audio.')); };
        await currentAudio.play();
        updateStatus();
        return;
      } catch (_) {
        if (prefs.engine === 'local') {
          speaking = false; updateStatus();
          showStatus(tr('خدمة Piper المحلية غير متاحة. شغّل الخدمة وثبّت نموذجًا صوتيًا.', 'Local Piper is unavailable. Start the service and install a voice model.'));
          return;
        }
      }
    }
    speaking = false;
    updateStatus();
    browserSpeak(String(text).slice(0, 2000));
  }
  function populateVoices(select, voices) {
    select.replaceChildren();
    voices.forEach(v => {
      const opt = make('option', '', v.label || v.id);
      opt.value = v.id;
      select.appendChild(opt);
    });
    if (voices.some(v => v.id === prefs.voice)) select.value = prefs.voice;
    else if (voices.length) { prefs.voice = voices[0].id; select.value = prefs.voice; savePrefs(); }
  }
  async function loadVoices(select) {
    try {
      const r = await fetch(ENDPOINT + '/voices', { cache: 'no-store' });
      if (!r.ok) throw new Error('no local service');
      const data = await r.json();
      populateVoices(select, data.voices || []);
      select.dataset.source = 'local';
      showStatus(tr('محرك Piper المحلي جاهز.', 'Local Piper engine is ready.'));
    } catch (_) {
      select.replaceChildren();
      if ('speechSynthesis' in global) {
        const voices = global.speechSynthesis.getVoices().map(v => ({ id: v.name, label: v.name + ' (' + v.lang + ')' }));
        populateVoices(select, voices);
      }
      select.dataset.source = 'browser';
      showStatus(tr('خدمة Piper غير متاحة؛ سيُستخدم صوت المتصفح الاحتياطي عند التشغيل.', 'Piper unavailable; browser fallback will be used when enabled.'));
    }
  }
  function init() {
    readPrefs();
    const panel = document.getElementById('spAiPanel');
    const messages = document.getElementById('spAiMessages');
    if (!panel || !messages || document.getElementById('meroTtsControls')) return;
    messagesNode = messages;
    const controls = make('section', 'sp-ai-tts', '');
    controls.id = 'meroTtsControls';
    controls.setAttribute('aria-label', tr('إعدادات صوت ميرو', 'Mero voice settings'));
    const top = make('div', 'sp-ai-tts-row');
    const toggle = make('button', 'sp-ai-tts-button', prefs.enabled ? tr('كتم الصوت', 'Mute voice') : tr('تشغيل الصوت', 'Enable voice'));
    toggle.type = 'button'; toggle.id = 'meroTtsToggle';
    toggle.setAttribute('aria-pressed', String(prefs.enabled));
    const status = make('span', 'sp-ai-tts-status', tr('الصوت متوقف', 'Voice idle'));
    status.id = 'meroTtsStatus'; status.setAttribute('aria-live', 'polite');
    const stopBtn = make('button', 'sp-ai-tts-button secondary', tr('إيقاف فوري', 'Stop now'));
    stopBtn.type = 'button'; stopBtn.id = 'meroTtsStop'; stopBtn.disabled = true;
    top.append(toggle, status, stopBtn);
    const settings = make('div', 'sp-ai-tts-settings');
    const voiceLabel = make('label', '', tr('الصوت', 'Voice'));
    const voice = make('select', 'sp-ai-tts-select'); voice.id = 'meroTtsVoice'; voiceLabel.appendChild(voice);
    const engineLabel = make('label', '', tr('المحرك', 'Engine'));
    const engine = make('select', 'sp-ai-tts-select'); engine.id = 'meroTtsEngine';
    [['auto', tr('محلي مع بديل', 'Local with fallback')], ['local', 'Piper local only'], ['browser', tr('صوت النظام الاحتياطي', 'System fallback')]].forEach(([v,l]) => { const o=make('option','',l); o.value=v; engine.appendChild(o); });
    engine.value = prefs.engine;
    const speedLabel = make('label', '', tr('سرعة الكلام', 'Speaking speed'));
    const speed = make('input', 'sp-ai-tts-range'); speed.type='range'; speed.min='0.6'; speed.max='1.5'; speed.step='0.1'; speed.value=String(prefs.speed); speedLabel.append(speed, make('small','',String(prefs.speed)+'×'));
    const pitchLabel = make('label', '', tr('درجة النبرة (البديل فقط)', 'Pitch (fallback only)'));
    const pitch = make('input', 'sp-ai-tts-range'); pitch.type='range'; pitch.min='0.5'; pitch.max='1.5'; pitch.step='0.1'; pitch.value=String(prefs.pitch); pitchLabel.append(pitch, make('small','',String(prefs.pitch)));
    settings.append(voiceLabel, engineLabel, speedLabel, pitchLabel);
    controls.append(top, settings);
    const header = panel.querySelector('.sp-ai-header');
    if (header) header.insertAdjacentElement('afterend', controls); else panel.prepend(controls);
    toggle.addEventListener('click', () => {
      prefs.enabled = !prefs.enabled; savePrefs();
      toggle.textContent = prefs.enabled ? tr('كتم الصوت','Mute voice') : tr('تشغيل الصوت','Enable voice');
      toggle.setAttribute('aria-pressed', String(prefs.enabled));
      if (!prefs.enabled) stop();
      else loadVoices(voice);
    });
    stopBtn.addEventListener('click', stop);
    engine.addEventListener('change', () => { prefs.engine=engine.value; savePrefs(); if(prefs.engine==='browser') loadVoices(voice); else loadVoices(voice); });
    voice.addEventListener('change', () => { prefs.voice=voice.value; savePrefs(); });
    speed.addEventListener('input', () => { prefs.speed=Number(speed.value); speedLabel.querySelector('small').textContent=prefs.speed+'×'; savePrefs(); });
    pitch.addEventListener('input', () => { prefs.pitch=Number(pitch.value); pitchLabel.querySelector('small').textContent=prefs.pitch; savePrefs(); });
    loadVoices(voice);
    updateStatus();

    // Observe only new assistant messages; user messages are never sent to TTS.
    const observer = new MutationObserver(records => {
      if (!prefs.enabled) return;
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.classList.contains('sp-ai-message') && node.classList.contains('is-assistant')) speak(node.textContent || '');
      }));
    });
    observer.observe(messages, { childList: true });
    global.MeroTTS = { speak, stop, getPreferences: () => Object.assign({}, prefs) };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})(window);
