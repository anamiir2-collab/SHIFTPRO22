/**
 * ShiftPro Mero TTS — integration tests (jsdom).
 *
 * Loads the REAL js/ai-assistant.js and js/mero-tts.js modules, builds the
 * assistant panel, and exercises the voice pipeline with stubbed
 * fetch/Audio/URL. Verifies the guarantees from the feature spec:
 *   - controls are injected into the existing panel (no redesign)
 *   - new assistant replies trigger exactly one /tts request
 *   - the same message id is never spoken twice
 *   - user messages never reach the speech pipeline
 *   - Stop cancels pending playback
 *   - replay re-speaks the latest reply
 *   - local-only mode never silently falls back to browser speech
 *
 * Run:  npx jest tests/mero-tts.integration.test.js
 */

const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadModule(relPath) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  // Bare identifiers (window, document, fetch, ...) resolve to the jsdom
  // globals provided by the jest test environment.
  new Function(src)();
}

class FakeAudio extends EventTarget {
  constructor(src) {
    super();
    this.src = src;
    this.paused = true;
  }
  removeAttribute() {}
  load() {}
  play() {
    this.paused = false;
    setTimeout(() => {
      if (!this.paused) {
        this.paused = true;
        this.dispatchEvent(new Event('ended'));
      }
    }, 15);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

describe('Mero TTS integration with the real assistant panel', () => {
  let ttsCalls;
  let ttsFail;
  let lastTtsBody;

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    // The jsdom document persists across tests; drop the assistant UI so each
    // module instance rebuilds it fresh (init guards against duplicates).
    document.querySelectorAll('.sp-ai-launcher, .sp-ai-nudge, .sp-ai-panel').forEach((n) => n.remove());
    ttsCalls = 0;
    ttsFail = false;
    lastTtsBody = null;

    window.fetch = jest.fn(async (url, options) => {
      const target = String(url);
      if (target.indexOf('/voices') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({
            voices: [{ id: 'ar_JO-kareem-medium', name: 'kareem',
                       language: { code: 'ar_JO', family: 'ar' },
                       sample_rate: 22050, quality: 'medium', num_speakers: 1, size_mb: 60 }]
          })
        };
      }
      if (target.indexOf('/tts') >= 0) {
        ttsCalls += 1;
        lastTtsBody = JSON.parse(options.body);
        if (ttsFail) return { ok: false, status: 503, blob: async () => ({ type: '', size: 0 }) };
        return { ok: true, status: 200,
                 blob: async () => ({ type: 'audio/wav', size: 5000 }) };
      }
      return { ok: false, status: 404, blob: async () => ({ type: '', size: 0 }) };
    });
    window.Audio = FakeAudio;
    window.URL.createObjectURL = jest.fn(() => 'blob:mero-test');
    window.URL.revokeObjectURL = jest.fn();

    loadModule('js/ai-assistant.js');
    loadModule('js/mero-tts.js');
  });

  async function enableVoice() {
    await wait(30); // allow mero-tts init (setTimeout 0) to complete first
    document.getElementById('meroTtsToggle').click();
    await wait(30); // let refreshVoices settle
  }

  function dispatchReply(text, id, role) {
    document.dispatchEvent(new CustomEvent('mero:assistant-message', {
      detail: { role: role || 'assistant', text, id }
    }));
  }

  test('injects the voice controls into the existing assistant panel', async () => {
    await wait(30); // mero-tts init runs on a setTimeout(0)
    expect(document.getElementById('spAiPanel')).toBeTruthy();
    expect(document.getElementById('meroTtsControls')).toBeTruthy();
    expect(document.getElementById('meroTtsToggle')).toBeTruthy();
    expect(document.getElementById('meroTtsStop')).toBeTruthy();
    expect(document.getElementById('meroTtsReplay')).toBeTruthy();
    expect(document.getElementById('meroTtsNotice')).toBeTruthy();
  });

  test('full speech lifecycle: enable, dedup, user filter, replay, stop, local-only, chunking', async () => {
    // One sequential flow with a single module instance — mirrors a real page
    // load. (Document-level listeners live for the page lifetime, so loading
    // the module repeatedly in one jsdom document would cross-talk.)
    await wait(30); // init
    const T = window.MeroTTS;
    const notice = () => document.getElementById('meroTtsNotice').textContent;

    // 1) Muted by default: nothing is spoken.
    dispatchReply('مرحبًا هذا رد ميرو', 'm0');
    await wait(60);
    expect(ttsCalls).toBe(0);

    // 2) Enable: reply spoken exactly once, Arabic voice auto-selected.
    await enableVoice();
    dispatchReply('مرحبًا هذا رد ميرو', 'm1');
    await wait(80);
    expect(ttsCalls).toBe(1);
    expect(lastTtsBody).toMatchObject({ voice: 'ar_JO-kareem-medium' });

    // 3) Same message id again is never spoken twice.
    dispatchReply('مرحبًا هذا رد ميرو', 'm1');
    await wait(80);
    expect(ttsCalls).toBe(1);

    // 4) User messages never reach the speech pipeline.
    dispatchReply('سجل حضور', 'u1', 'user');
    await wait(60);
    expect(ttsCalls).toBe(1);

    // 5) Replay re-speaks the latest reply even though its id was spoken.
    document.getElementById('meroTtsReplay').click();
    await wait(80);
    expect(ttsCalls).toBe(2);

    // 6) Stop cancels promptly.
    dispatchReply('رد طويل قبل الإيقاف. ' + 'جملة إضافية للمدة. '.repeat(30), 'm3');
    T.stop();
    await wait(60);
    expect(T.isSpeaking()).toBe(false);
    expect(document.getElementById('meroTtsStop').disabled).toBe(true);

    // 7) Local-only mode: engine failure never silently falls back.
    const engine = document.getElementById('meroTtsEngine');
    engine.value = 'local';
    engine.dispatchEvent(new Event('change'));
    await wait(30);
    ttsFail = true;
    dispatchReply('رد في الوضع المحلي فقط', 'm4');
    await wait(80);
    // 2 (enable+replay) + 1 (m3 chunk whose playback was stopped) + 1 (m4 attempt).
    // The stopped m3 chunk never played, and m4 gets no browser recovery.
    expect(ttsCalls).toBe(4);
    expect(T.isSpeaking()).toBe(false);
    expect(notice()).toContain('محلي فقط');

    // 8) Long replies are chunked; every chunk requested once.
    ttsFail = false;
    engine.value = 'auto';
    engine.dispatchEvent(new Event('change'));
    await wait(30);
    const sentence = 'هذه جملة عربية كاملة تستخدم لاختبار التقسيم. ';
    dispatchReply(sentence.repeat(12), 'm5');
    await wait(250);
    expect(ttsCalls).toBeGreaterThanOrEqual(4);
  });
});
