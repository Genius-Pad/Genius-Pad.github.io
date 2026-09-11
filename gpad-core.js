/*
 * Чистое ядро билдера .gpad: crc32, zip (stored), WAV 16-бит, сборка kit.json.
 * Классический скрипт (не ES-модуль) — грузится по file:// без CORS и
 * require()-ится под Node в selftest.cjs. Без DOM и без Web Audio.
 *
 * Контракт .gpad — из app/src/main/java/com/podvalgames/geniuspad/kit/
 * (GpadKit.kt, WavDecode.kt): zip с kit.json в корне + PCM16 WAV, format 2 =
 * ровно 4 банка по 16 пэдов, у каждого пэда существующий sample.
 */
var GpadCore = (function () {
  'use strict';

  var UTF8 = new TextEncoder();

  // --- CRC32 --------------------------------------------------------

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // --- ZIP (только stored, метод 0) -----------------------------

  function concat(chunks) {
    var len = 0, i;
    for (i = 0; i < chunks.length; i++) len += chunks[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }

  /** entries: [{ name, data: Uint8Array }] → Uint8Array целого архива (без сжатия). */
  function zipStore(entries) {
    var chunks = [], central = [], offset = 0;
    var DOS_DATE = 0x21; // 1980-01-01

    for (var e = 0; e < entries.length; e++) {
      var name = UTF8.encode(entries[e].name);
      var data = entries[e].data;
      var crc = crc32(data);

      var lh = new Uint8Array(30 + name.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);   // UTF-8 имя
      lv.setUint16(8, 0, true);        // stored
      lv.setUint16(10, 0, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      lh.set(name, 30);
      chunks.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
    }

    var cd = concat(central);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cd.length, true);
    ev.setUint32(16, offset, true);
    return concat(chunks.concat([cd, eocd]));
  }

  /**
   * Читает zip по центральному каталогу. inflateRaw(u8)->u8|Promise нужен
   * только для записей метода 8 (чужие .gpad); наши архивы stored.
   * → Promise<{ [name]: Uint8Array }> (каталоги пропущены).
   */
  async function zipRead(bytes, inflateRaw) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip (no EOCD)');

    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var out = {};
    var dec = new TextDecoder();

    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var lhOffset = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.charAt(name.length - 1) === '/') continue;

      if (dv.getUint32(lhOffset, true) !== 0x04034b50) throw new Error('bad local header');
      var lhNameLen = dv.getUint16(lhOffset + 26, true);
      var lhExtraLen = dv.getUint16(lhOffset + 28, true);
      var start = lhOffset + 30 + lhNameLen + lhExtraLen;
      var raw = bytes.subarray(start, start + compSize);

      var data;
      if (method === 0) {
        data = raw.slice();
      } else if (method === 8) {
        if (!inflateRaw) throw new Error('entry "' + name + '" is deflated, no inflater');
        data = await inflateRaw(raw);
      } else {
        throw new Error('entry "' + name + '" uses unsupported method ' + method);
      }
      out[name] = data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    return out;
  }

  // --- WAV 16-бит PCM --------------------------------------------

  /** mono: Float32Array в [-1,1] → Uint8Array целого WAV (PCM16, моно). */
  function encodeWav16(mono, sampleRate) {
    var dataLen = mono.length * 2;
    var buf = new Uint8Array(44 + dataLen);
    var dv = new DataView(buf.buffer);
    function ascii(o, s) { for (var i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); }

    ascii(0, 'RIFF');
    dv.setUint32(4, 36 + dataLen, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);            // PCM
    dv.setUint16(22, 1, true);            // моно
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, 'data');
    dv.setUint32(40, dataLen, true);

    var o = 44;
    for (var i = 0; i < mono.length; i++) {
      var s = mono[i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      dv.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      o += 2;
    }
    return buf;
  }

  /** Зеркало decodeWavToMono: PCM16, N каналов → моно. null — не PCM16 WAV. */
  function decodeWav(bytes) {
    if (bytes.length < 44) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function tag(o) { return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]); }
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

    var pos = 12, audioFormat = 0, channels = 0, rate = 0, bits = 0, dataOff = -1, dataSize = 0;
    while (pos + 8 <= bytes.length) {
      var id = tag(pos);
      var size = dv.getUint32(pos + 4, true);
      var body = pos + 8;
      if (id === 'fmt ' && body + 16 <= bytes.length) {
        audioFormat = dv.getUint16(body, true);
        channels = dv.getUint16(body + 2, true);
        rate = dv.getUint32(body + 4, true);
        bits = dv.getUint16(body + 14, true);
      } else if (id === 'data') {
        dataOff = body;
        dataSize = size;
      }
      pos = body + size + (size & 1);
    }
    if (dataOff < 0 || audioFormat !== 1 || bits !== 16 || channels < 1 || rate <= 0) return null;

    var avail = Math.min(dataSize, bytes.length - dataOff);
    var frames = Math.floor(avail / 2 / channels);
    if (frames < 1) return null;

    var mono = new Float32Array(frames), s = dataOff;
    for (var i = 0; i < frames; i++) {
      var acc = 0;
      for (var c = 0; c < channels; c++) { acc += dv.getInt16(s, true) / 32768; s += 2; }
      mono[i] = acc / channels;
    }
    return { mono: mono, sampleRate: rate };
  }

  // --- kit.json --------------------------------------------------

  var BANK_IDS = ['A', 'B', 'C', 'D'];
  var SILENT_SAMPLE = '_.wav';
  var GPAD_EXT = '.gp';
  // Мягкий потолок размера кита для каталога — с запасом под 25 МБ, которые
  // даёт веб-форма загрузки GitHub (см. buildCatalogEntry/Publish и
  // scripts/validate-catalog.mjs в репозитории каталога — оба читают именно
  // эту константу, а не хранят своё число).
  var MAX_KIT_BYTES = 20 * 1024 * 1024;

  /** Имя файла → безопасный кусок пути. Пусто → "pad". */
  function sanitizeLabel(s) {
    var cleaned = String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'pad';
  }

  /** Зеркало sampleStem приложения: стем имени файла, `_`/`-`→пробел, upper. */
  function sampleStem(path) {
    var base = String(path).split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
    var cleaned = base.replace(/[_-]/g, ' ').trim().toUpperCase();
    return cleaned || 'PAD';
  }

  /** Путь наружу песочницы — зеркало unsafeEntryName. */
  function unsafeEntryName(name) {
    if (name.indexOf('\\') >= 0) return true;
    if (name.charAt(0) === '/') return true;
    if (name.length >= 2 && name.charAt(1) === ':') return true;
    return name.split('/').indexOf('..') >= 0;
  }

  function clampBpm(v) {
    v = Number(v) || 90;
    return Math.min(300, Math.max(40, v));
  }

  /**
   * kit: { name, author, bpm, banks: [ { pads: [ pad|null ] × 16 } × 4 ] }
   * pad: { sample: "samples/A/kick.wav" }  (обрезка запечена в WAV)
   * Пустой пэд (null) → ссылка на SILENT_SAMPLE.
   */
  function buildKitJson(kit) {
    var banks = [];
    for (var bi = 0; bi < 4; bi++) {
      var src = (kit.banks[bi] && kit.banks[bi].pads) || [];
      var pads = [];
      for (var i = 0; i < 16; i++) {
        var pad = src[i];
        pads.push({
          index: i,
          sample: pad && pad.sample ? pad.sample : SILENT_SAMPLE,
          start: 0,
          end: -1,
        });
      }
      banks.push({ id: BANK_IDS[bi], pads: pads });
    }
    return JSON.stringify({
      format: 2,
      name: ((kit.name || 'Untitled Kit').trim()) || 'Untitled Kit',
      author: (kit.author || '').trim(),
      bpm: clampBpm(kit.bpm),
      banks: banks,
    }, null, 2);
  }

  /** ~0.1 с тишины @ 44100 — заглушка пустых пэдов. */
  function silentWav() {
    return encodeWav16(new Float32Array(4410), 44100);
  }

  /**
   * kit — как в buildKitJson. samples: [{ path, data: Uint8Array WAV }] или
   * Map<path,data> для всех непустых пэдов. → Uint8Array целого .gpad.
   */
  function assembleGpad(kit, samples) {
    var entries = [
      { name: 'kit.json', data: UTF8.encode(buildKitJson(kit)) },
      { name: SILENT_SAMPLE, data: silentWav() },
    ];
    var seen = { 'kit.json': 1 };
    seen[SILENT_SAMPLE] = 1;
    var list = samples instanceof Map
      ? Array.from(samples, function (kv) { return { path: kv[0], data: kv[1] }; })
      : samples;
    for (var i = 0; i < list.length; i++) {
      var path = list[i].path;
      if (seen[path]) continue;
      seen[path] = 1;
      entries.push({ name: path, data: list[i].data });
    }
    return zipStore(entries);
  }

  // --- Проверка структуры (реимплементация проверок загрузчика) --

  var MAX_ENTRIES = 256;
  var MAX_UNPACKED = 100 * 1024 * 1024;

  async function validateGpadStructure(bytes, inflateRaw) {
    var errors = [];
    var files;
    try {
      files = await zipRead(bytes, inflateRaw);
    } catch (e) {
      return { ok: false, errors: ['archive: ' + e.message] };
    }
    var names = Object.keys(files);
    if (names.length > MAX_ENTRIES) errors.push('too many entries: ' + names.length);
    var total = 0;
    for (var i = 0; i < names.length; i++) {
      if (unsafeEntryName(names[i])) errors.push('unsafe path: ' + names[i]);
      total += files[names[i]].length;
    }
    if (total > MAX_UNPACKED) errors.push('unpacked too large: ' + total);

    if (!files['kit.json']) return { ok: false, errors: errors.concat(['no kit.json']) };
    var o;
    try {
      o = JSON.parse(new TextDecoder().decode(files['kit.json']));
    } catch (e) {
      return { ok: false, errors: errors.concat(['bad kit.json: ' + e.message]) };
    }

    if (o.format !== 1 && o.format !== 2) errors.push('unsupported format ' + o.format);

    var banks;
    if (o.format <= 1) {
      var flat = Array.isArray(o.pads) ? o.pads : [];
      banks = BANK_IDS.map(function (id) { return { id: id, pads: flat }; });
    } else {
      banks = Array.isArray(o.banks) ? o.banks : [];
    }
    if (banks.length !== 4) errors.push('expected 4 banks, got ' + banks.length);

    banks.slice(0, 4).forEach(function (bank, bi) {
      var id = BANK_IDS[bi];
      var pads = Array.isArray(bank.pads) ? bank.pads : [];
      if (pads.length !== 16) errors.push('bank ' + id + ': expected 16 pads, got ' + pads.length);
      var seen = {};
      pads.forEach(function (p) {
        if (typeof p.index !== 'number' || p.index < 0 || p.index > 15) {
          errors.push('bank ' + id + ': pad index ' + p.index + ' out of range');
          return;
        }
        if (seen[p.index]) errors.push('bank ' + id + ': duplicate pad index ' + p.index);
        seen[p.index] = 1;
        if (typeof p.sample !== 'string' || !files[p.sample]) {
          errors.push('bank ' + id + ': missing sample ' + p.sample);
          return;
        }
        if (!decodeWav(files[p.sample])) {
          errors.push('bank ' + id + ': ' + p.sample + ' is not 16-bit PCM WAV');
        }
      });
    });

    return { ok: errors.length === 0, errors: errors };
  }

  // --- каталог: sha256 и запись для catalog.json ------------------

  /**
   * Hex-строка SHA-256. В браузере/Node 19+ — сам `crypto.subtle`; для
   * старого Node передать `digestFn(bytes) -> Promise<ArrayBuffer>` (напр.
   * обёртку над `node:crypto`).
   */
  async function sha256Hex(bytes, digestFn) {
    var buf;
    if (digestFn) {
      buf = await digestFn(bytes);
    } else if (typeof crypto !== 'undefined' && crypto.subtle) {
      buf = await crypto.subtle.digest('SHA-256', bytes);
    } else {
      throw new Error('no SHA-256 implementation available (pass digestFn)');
    }
    var view = new Uint8Array(buf), hex = '';
    for (var i = 0; i < view.length; i++) hex += (view[i] < 16 ? '0' : '') + view[i].toString(16);
    return hex;
  }

  /**
   * Запись для `catalog.json`. `kit` — {name, author, bpm}, `bytes` —
   * собранный .gp (для sizeBytes), `sha256` — уже посчитанный hex (функция
   * синхронная). `id` стабилен для одних (name, sha256) — не зависит от
   * времени, чтобы повторная сборка того же кита не плодила новых записей.
   */
  function buildCatalogEntry(kit, bytes, sha256, opts) {
    opts = opts || {};
    var prefix = opts.filePrefix != null ? opts.filePrefix : 'kits/';
    var name = ((kit.name || 'Untitled Kit').trim()) || 'Untitled Kit';
    var slug = sanitizeLabel(name).toLowerCase().replace(/\s+/g, '-');
    var short = String(sha256 || '').slice(0, 6);
    var id = short ? (slug + '-' + short) : slug;
    return {
      id: id,
      name: name,
      author: (kit.author || '').trim(),
      bpm: Math.min(300, Math.max(40, Number(kit.bpm) || 90)),
      file: prefix + id + GPAD_EXT,
      sizeBytes: bytes ? bytes.length : 0,
      sha256: sha256 || '',
      addedAt: opts.addedAt || new Date().toISOString(),
    };
  }

  return {
    crc32: crc32,
    zipStore: zipStore,
    zipRead: zipRead,
    encodeWav16: encodeWav16,
    decodeWav: decodeWav,
    sanitizeLabel: sanitizeLabel,
    sampleStem: sampleStem,
    unsafeEntryName: unsafeEntryName,
    buildKitJson: buildKitJson,
    silentWav: silentWav,
    assembleGpad: assembleGpad,
    validateGpadStructure: validateGpadStructure,
    sha256Hex: sha256Hex,
    buildCatalogEntry: buildCatalogEntry,
    BANK_IDS: BANK_IDS,
    SILENT_SAMPLE: SILENT_SAMPLE,
    GPAD_EXT: GPAD_EXT,
    MAX_KIT_BYTES: MAX_KIT_BYTES,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GpadCore;
