/**
 * ShiftPro Mero TTS — pure helper tests.
 *
 * js/mero-tts.js exposes its pure helpers as window.MeroTTS._test so they can
 * be unit-tested without a DOM, without the local service, and without
 * speechSynthesis — mirroring the SPAssistant._processMessage test seam.
 *
 * Run:  npx jest tests/mero-tts.test.js
 */

const fs = require('fs');
const path = require('path');

const ttsSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'mero-tts.js'),
  'utf8'
);

// Same sandbox pattern as tests/assistant.test.js: the module attaches itself
// to the global object it receives. jsdom provides document/localStorage.
const sandbox = {};
const fn = new Function('window', 'global', 'self', 'document', ttsSrc);
fn(sandbox, sandbox, sandbox, window);
const T = sandbox.MeroTTS;
const helpers = T._test;

describe('Mero TTS settings sanitation', () => {
  test('garbage input falls back to safe defaults', () => {
    const clean = helpers.sanitizeSettings('not-an-object');
    expect(clean).toEqual({
      enabled: false,
      autoSpeak: true,
      engine: 'auto',
      langPref: 'auto',
      voiceAr: '',
      voiceEn: '',
      browserVoice: '',
      speed: 1,
      pitch: 1
    });
  });

  test('out-of-range values are clamped and invalid enums rejected', () => {
    const clean = helpers.sanitizeSettings({
      enabled: 'yes',
      engine: 'cloud-tts',
      langPref: 'fr',
      speed: 9,
      pitch: -3,
      voiceAr: { evil: true }
    });
    expect(clean.enabled).toBe(false); // must be strictly true
    expect(clean.engine).toBe('auto');
    expect(clean.langPref).toBe('auto');
    expect(clean.speed).toBe(1.5);
    expect(clean.pitch).toBe(0.5);
    expect(clean.voiceAr).toBe('');
  });

  test('local-only mode and autoSpeak=false survive sanitation', () => {
    const clean = helpers.sanitizeSettings({ engine: 'local', autoSpeak: false, enabled: true });
    expect(clean.engine).toBe('local');
    expect(clean.autoSpeak).toBe(false);
    expect(clean.enabled).toBe(true);
  });

  test('legacy v1 settings migrate (voice routed by language prefix)', () => {
    const migrated = helpers.migrateLegacy({
      enabled: true, engine: 'local', voice: 'ar_JO-kareem-medium', speed: 0.9
    });
    expect(migrated.enabled).toBe(true);
    expect(migrated.engine).toBe('local');
    expect(migrated.voiceAr).toBe('ar_JO-kareem-medium');
    expect(migrated.voiceEn).toBe('');
    expect(migrated.speed).toBe(0.9);
    expect(migrated.pitch).toBe(1);
  });
});

describe('Mero TTS speech text preparation', () => {
  test('removes markdown, links, URLs, code fences and emoji', () => {
    const raw = '## ملخص 💡\nاكتب `help` أو افتح [التقارير](https://example.com/x) من https://foo.bar لاكتساب ' +
      '```code block``` نهاية';
    const clean = helpers.normalizeSpeechText(raw);
    expect(clean).not.toMatch(/[#*`>]/);
    expect(clean).not.toMatch(/https?:\/\//);
    expect(clean).not.toMatch(/💡/);
    expect(clean).toContain('اكتب help');
    expect(clean).toContain('التقارير');
    expect(clean).toContain('نهاية');
  });

  test('strips zero-width and bidi control characters', () => {
    const raw = 'مر\u200bحب\u200fًا';
    expect(helpers.normalizeSpeechText(raw)).toBe('مرحبًا');
  });

  test('caps absurdly long text instead of failing the engine', () => {
    const clean = helpers.normalizeSpeechText('أ'.repeat(9999));
    expect(clean.length).toBeLessThanOrEqual(4000);
  });

  test('detects Arabic vs English replies', () => {
    expect(helpers.detectSpeechLanguage('أهلًا بك في تطبيق شيفبرو')).toBe('ar');
    expect(helpers.detectSpeechLanguage('Hello! I am Mero, your assistant.')).toBe('en');
    // Mixed with dominant Arabic -> Arabic voice
    expect(helpers.detectSpeechLanguage('افتح تطبيق PDF الآن')).toBe('ar');
  });

  test('splits long text into sentence-bounded chunks without losing content', () => {
    const sentences = Array.from({ length: 12 }, (_, i) =>
      `هذه هي الجملة رقم ${i + 1} وهي تحتوي على كلمات كافية للفصل.`);
    const text = sentences.join(' ');
    const chunks = helpers.splitIntoChunks(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(130));
    expect(chunks.join(' ')).toBe(text);
  });

  test('never returns an empty chunk list for non-empty text', () => {
    expect(helpers.splitIntoChunks('مرحبًا', 700)).toEqual(['مرحبًا']);
    expect(helpers.splitIntoChunks('', 700)).toEqual([]);
  });
});

describe('Mero TTS voice selection', () => {
  const voices = [
    { id: 'ar_JO-kareem-medium', language: { code: 'ar_JO', family: 'ar' } },
    { id: 'en_US-lessac-medium', language: { code: 'en_US', family: 'en' } }
  ];

  test('matches installed voice by language family', () => {
    expect(helpers.pickVoiceForLanguage('ar', voices, '', '').id).toBe('ar_JO-kareem-medium');
    expect(helpers.pickVoiceForLanguage('en', voices, '', '').id).toBe('en_US-lessac-medium');
  });

  test('prefers the user-selected voice per language', () => {
    expect(helpers.pickVoiceForLanguage('en', voices, '', 'en_US-lessac-medium').id)
      .toBe('en_US-lessac-medium');
  });

  test('returns null instead of guessing when no model for that language exists', () => {
    const englishOnly = [voices[1]];
    expect(helpers.pickVoiceForLanguage('ar', englishOnly, '', '')).toBeNull();
    expect(helpers.pickVoiceForLanguage('ar', [], '', '')).toBeNull();
  });
});

describe('Mero TTS module surface', () => {
  test('exposes the public API and never auto-enables speech', () => {
    expect(typeof T.init).toBe('function');
    expect(typeof T.speak).toBe('function');
    expect(typeof T.stop).toBe('function');
    expect(typeof T.replayLast).toBe('function');
    expect(typeof T.refreshVoices).toBe('function');
    expect(T.getPreferences().enabled).toBe(false); // muted by default
  });

  test('speak() is a no-op while muted (muted mode never starts speech)', () => {
    T.speak('مرحبًا هذا رد تجريبي للنطق');
    expect(T.isSpeaking()).toBe(false);
  });
});
