/*
 * Проверка каталога перед мержем PR. Гоняется в CI (.github/workflows/validate-catalog.yml)
 * и локально:  node scripts/validate-catalog.cjs
 *
 * Ничего не публикует и не чинит — только находит проблемы и падает с
 * ненулевым кодом, если они есть. Источник правды для лимита размера —
 * GpadCore.MAX_KIT_BYTES (gpad-core.js), а не отдельное число здесь.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'gpad-core.js'));
const inflateRaw = (u8) => new Uint8Array(inflateRawSync(u8));
const sha256Digest = async (bytes) => createHash('sha256').update(bytes).digest();

const errors = [];
const fail = (msg) => errors.push(msg);

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`catalog.json: couldn't parse — ${e.message}`);
    return null;
  }
}

const REQUIRED_FIELDS = ['id', 'name', 'author', 'bpm', 'file', 'sizeBytes', 'sha256', 'addedAt'];

async function main() {
  const catalogPath = path.join(ROOT, 'catalog.json');
  if (!fs.existsSync(catalogPath)) { fail('catalog.json is missing'); report(); return; }

  const catalog = readJson(catalogPath);
  if (!catalog) { report(); return; }

  if (typeof catalog.version !== 'number') fail('catalog.json: "version" must be a number');
  if (typeof catalog.updatedAt !== 'string') fail('catalog.json: "updatedAt" must be a ISO date string');
  if (!Array.isArray(catalog.kits)) { fail('catalog.json: "kits" must be an array'); report(); return; }

  const seenIds = new Set();
  const referencedFiles = new Set();

  for (const [i, entry] of catalog.kits.entries()) {
    const tag = `kits[${i}]` + (entry && entry.id ? ` (${entry.id})` : '');

    for (const field of REQUIRED_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
        fail(`${tag}: missing field "${field}"`);
      }
    }
    if (!entry.id) continue; // остальные проверки без id бессмысленны

    if (seenIds.has(entry.id)) fail(`${tag}: duplicate id "${entry.id}"`);
    seenIds.add(entry.id);

    if (typeof entry.file !== 'string' || !entry.file.startsWith('kits/') || !entry.file.endsWith(C.GPAD_EXT)) {
      fail(`${tag}: "file" must look like "kits/<name>${C.GPAD_EXT}", got "${entry.file}"`);
      continue;
    }
    referencedFiles.add(entry.file);

    const filePath = path.join(ROOT, entry.file);
    if (!fs.existsSync(filePath)) { fail(`${tag}: file not found: ${entry.file}`); continue; }

    const bytes = fs.readFileSync(filePath);

    if (bytes.length > C.MAX_KIT_BYTES) {
      fail(`${tag}: ${(bytes.length / 1024 / 1024).toFixed(2)} MB exceeds the ${C.MAX_KIT_BYTES / 1024 / 1024} MB catalog limit`);
    }
    if (typeof entry.sizeBytes === 'number' && entry.sizeBytes !== bytes.length) {
      fail(`${tag}: sizeBytes (${entry.sizeBytes}) doesn't match the actual file size (${bytes.length})`);
    }

    const hex = await C.sha256Hex(new Uint8Array(bytes), sha256Digest);
    if (entry.sha256 !== hex) {
      fail(`${tag}: sha256 mismatch — catalog says ${entry.sha256}, file hashes to ${hex}`);
    }

    const structure = await C.validateGpadStructure(new Uint8Array(bytes), inflateRaw);
    if (!structure.ok) {
      fail(`${tag}: ${entry.file} failed structure check — ${structure.errors.join('; ')}`);
    }

    if (typeof entry.bpm === 'number' && (entry.bpm < 40 || entry.bpm > 300)) {
      fail(`${tag}: bpm ${entry.bpm} is outside the sane 40-300 range`);
    }
  }

  // осиротевшие .gp — есть на диске, но не упомянуты в catalog.json
  const kitsDir = path.join(ROOT, 'kits');
  if (fs.existsSync(kitsDir)) {
    for (const name of fs.readdirSync(kitsDir)) {
      if (!name.endsWith(C.GPAD_EXT)) continue;
      const rel = 'kits/' + name;
      if (!referencedFiles.has(rel)) fail(`kits/${name}: not referenced by any catalog.json entry (orphan file)`);
    }
  }

  report();
}

function report() {
  if (errors.length === 0) {
    console.log('catalog.json + kits/ — all OK (' + 'checked ' + 'structure, size, sha256, schema)');
    process.exit(0);
  }
  console.log(`${errors.length} problem(s):\n`);
  for (const e of errors) console.log('  ✗ ' + e);
  console.log('');
  process.exit(1);
}

main().catch((e) => { console.error('validator crashed:', e); process.exit(1); });
