#!/usr/bin/env node
/**
 * LLM-backed locale fill from English (via `hermes -z`).
 *
 * - SSOT keys: packages/shared/locales/en/*.json (not translation.json)
 * - Writes target locale namespace files in place
 * - Disk cache: .cache/i18n-llm/{lang}.json  (en -> tr)
 * - Preserves {{placeholders}}; skips brand/code-like / punctuation-only
 *
 * Usage:
 *   node scripts/i18n-llm-translate.mjs --lang ja
 *   node scripts/i18n-llm-translate.mjs --lang ko --batch 60 --max-batches 5
 *   node scripts/i18n-llm-translate.mjs --lang ja --dry-run
 *   node scripts/i18n-llm-translate.mjs --lang ja --stats-only
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'packages/shared/locales');
const CACHE_DIR = path.join(ROOT, '.cache/i18n-llm');

const SKIP_NS = new Set(['translation.json']);
const BRAND_RE =
  /^(YSK Server|ysk-server|YSK|OpenClaw|Hermes|IonClaw|SnappyMail|Roundcube|Postfix|Dovecot|OpenDKIM|PowerDNS|fail2ban|Node\.js|Python( 3)?|OPcache|Memcached|Cloudflare|Fastly|Bunny CDN|AWS CloudFront|Azure Front Door|Gcore CDN|DNSSEC|DKIM( TXT)?|DMARC( TXT)?|DNSBL|FTPS|WebAuthn|Passkey( \/ WebAuthn)?|macOS Finder|Windows|Journal|systemd|Cron|Rust|Java|Kotlin|Nginx|Apache|MySQL|MariaDB|PostgreSQL|Redis|Docker|Linux|Ubuntu|Debian|UFW|SSO|FPM|CLI|API|JSON|XML|CSV|HTML|CSS|JS|UI|SSH|FTP|CDN|VPN|VNC|SQL|PHP|TLS|SSL|HTTP|HTTPS|OK|ID|IP|URL)$/i;

const LANG_NAME = {
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish (Spain)',
  fr: 'French (France)',
  pt: 'Portuguese (Portugal)',
  id: 'Indonesian',
  hi: 'Hindi',
  bn: 'Bengali',
  ar: 'Arabic (MSA)',
  ur: 'Urdu',
};

function parseArgs(argv) {
  const out = {
    lang: null,
    batch: 55,
    maxBatches: 0, // 0 = unlimited
    dryRun: false,
    statsOnly: false,
    model: process.env.I18N_HERMES_MODEL || '',
    timeoutSec: Number(process.env.I18N_HERMES_TIMEOUT || 180),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') out.lang = argv[++i];
    else if (a === '--batch') out.batch = Number(argv[++i]);
    else if (a === '--max-batches') out.maxBatches = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--stats-only') out.statsOnly = true;
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--timeout') out.timeoutSec = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/i18n-llm-translate.mjs --lang ja [--batch 55] [--max-batches N]`);
      process.exit(0);
    }
  }
  if (!out.lang) {
    console.error('Missing --lang');
    process.exit(2);
  }
  if (!LANG_NAME[out.lang]) {
    console.error(`Unsupported lang: ${out.lang}`);
    process.exit(2);
  }
  return out;
}

function listNsFiles(lang) {
  const dir = path.join(LOCALES, lang);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP_NS.has(f))
    .sort();
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** Walk object; yield [pathParts[], value] for string leaves. */
function* walkLeaves(node, parts = []) {
  if (typeof node === 'string') {
    yield [parts, node];
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      if (typeof item === 'string') yield [[...parts, String(i)], item];
      else if (item && typeof item === 'object') yield* walkLeaves(item, [...parts, String(i)]);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') yield [[...parts, k], v];
      else if (v && typeof v === 'object') yield* walkLeaves(v, [...parts, k]);
    }
  }
}

function setAt(root, parts, value) {
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const idx = Number.isInteger(Number(p)) && String(Number(p)) === p;
    if (cur[p] == null) cur[p] = Number.isInteger(Number(next)) && String(Number(next)) === next ? [] : {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getAt(root, parts) {
  let cur = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isSkippable(s) {
  if (s == null) return true;
  const t = String(s);
  if (!t.trim()) return true;
  if (BRAND_RE.test(t.trim())) return true;
  // short ops tokens that stay English in the panel
  if (
    /^(stderr|stdout|stdin|localhost|download|Runtime|Unit|Deploy|Reload|Conf|Admin|Operator|Viewer|Agent|Interpreter|MemoryMax|Online|Offline|Error|Status|Plan|Playbooks|Peers|Runtimes|Service|Type|Experimental\.?|ack \+ CLI JSON|EXECUTE \{\{state\}\}|warn\+|info\+|Web \+ FTPS|CIDR|PASV|TXT|QR|Host|Panel|Git|Go|No|Yes|normal|min|OK|DNS OK|Certbot|Restic|vsftpd|cargo|Chromium|Chrome)$/i.test(
      t.trim(),
    )
  ) {
    return true;
  }
  // short time / count templates kept English-style
  if (/^(\d+\s*min|\{\{[a-zA-Z0-9_.]+\}\}\s*min|\{\{[a-zA-Z0-9_.]+\}\}d|·\s*\{\{[^}]+\}\}.*)$/i.test(t.trim())) {
    return true;
  }
  // product + short paren tags
  if (/^(vsftpd|Certbot|Restic|Chromium)(\s*\/\s*Chrome)?(\s*\([^)]*\))?$/i.test(t.trim())) {
    return true;
  }
  if (/^Rust \(cargo\)$/i.test(t.trim())) return true;
  if (/^Web — apex \+ www$/i.test(t.trim())) return true;
  if (/^Playbooks \(\{\{count\}\}\)$/i.test(t.trim())) return true;
  if (/^Restic incremental$/i.test(t.trim())) return true;
  if (/^Certbot \(Let's Encrypt\)$/i.test(t.trim())) return true;
  // pure {{placeholder}}
  if (/^\{\{[a-zA-Z0-9_.]+\}\}$/.test(t.trim())) return true;
  // punctuation / numbers / units only
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return true;
  // bare paths / flags / unit names
  if (/^(\/[A-Za-z0-9._\-\/]+)$/.test(t)) return true;
  if (/^--?[a-z0-9][a-z0-9\-]*$/i.test(t)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t) && t.length <= 32) return true;
  // mostly code: backticks or shell-like with no letters to translate meaningfully
  if (/^`[^`]+`$/.test(t)) return true;
  return false;
}

function extractPlaceholders(s) {
  const set = new Set();
  for (const m of String(s).matchAll(/\{\{[^}]+\}\}/g)) set.add(m[0]);
  for (const m of String(s).matchAll(/%\d*\$?[sdif]/g)) set.add(m[0]);
  return [...set];
}

function placeholdersOk(en, tr) {
  const a = extractPlaceholders(en).sort().join('\0');
  const b = extractPlaceholders(tr).sort().join('\0');
  return a === b;
}

function loadCache(lang) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, `${lang}.json`);
  if (!fs.existsSync(p)) return { path: p, map: {} };
  try {
    return { path: p, map: loadJson(p) };
  } catch {
    return { path: p, map: {} };
  }
}

function saveCache(cache) {
  writeJson(cache.path, cache.map);
}

function collectNeed(lang) {
  const need = []; // { ns, parts, en, key }
  const byEn = new Map(); // en -> indices into need
  for (const file of listNsFiles('en')) {
    const enObj = loadJson(path.join(LOCALES, 'en', file));
    const ns = file;
    const tgtPath = path.join(LOCALES, lang, file);
    const tgtObj = fs.existsSync(tgtPath) ? loadJson(tgtPath) : {};
    for (const [parts, enVal] of walkLeaves(enObj)) {
      const cur = getAt(tgtObj, parts);
      const key = `${ns}::${parts.join('.')}`;
      if (isSkippable(enVal)) continue;
      if (typeof cur === 'string' && cur !== enVal) continue; // already translated
      // still English or missing
      const item = { ns, parts, en: enVal, key };
      const idx = need.length;
      need.push(item);
      if (!byEn.has(enVal)) byEn.set(enVal, []);
      byEn.get(enVal).push(idx);
    }
  }
  return { need, byEn };
}

function statsFor(lang) {
  let total = 0;
  let still = 0;
  let skip = 0;
  let translated = 0;
  for (const file of listNsFiles('en')) {
    const enObj = loadJson(path.join(LOCALES, 'en', file));
    const tgtPath = path.join(LOCALES, lang, file);
    const tgtObj = fs.existsSync(tgtPath) ? loadJson(tgtPath) : {};
    for (const [parts, enVal] of walkLeaves(enObj)) {
      if (typeof enVal !== 'string') continue;
      total++;
      if (isSkippable(enVal)) {
        skip++;
        continue;
      }
      const cur = getAt(tgtObj, parts);
      if (typeof cur === 'string' && cur !== enVal) translated++;
      else still++;
    }
  }
  const denom = total - skip;
  const pct = denom ? ((translated / denom) * 100).toFixed(1) : '100.0';
  return { total, skip, still, translated, pct };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildPrompt(lang, pairs) {
  const langName = LANG_NAME[lang];
  const payload = pairs.map((p, i) => ({ i, t: p }));
  return `You are a professional UI localization engine for a Linux server control panel (YSK Server).

Translate each English string into ${langName}.

HARD RULES:
1. Return ONLY a valid JSON array (no markdown fences, no commentary).
2. Array length MUST equal input length. Each element: {"i": <number>, "tr": "<translation>"}.
3. Preserve EVERY {{placeholder}} and %s/%d token EXACTLY (same spelling).
4. Keep brand tokens as-is inside sentences: YSK Server, ysk-server, YSK, OpenClaw, Hermes, IonClaw, Nginx, Dovecot, Postfix, Roundcube, SnappyMail.
5. Keep pure code tokens as-is: file paths, CLI flags (--foo), unit names, bare hostnames.
6. Tone: professional ops console — concise, not marketing.
7. Keep punctuation style appropriate for ${langName}; preserve leading/trailing spaces if present.
8. CRITICAL: Natural-language UI sentences MUST be fully translated into ${langName}. Returning the original English for a normal sentence is a FAILURE. Only leave a string completely unchanged if it is 100% code/brand with no prose.
9. Prefer natural ${langName} used in sysadmin UIs (not literal word-by-word).

INPUT:
${JSON.stringify(payload)}`;
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  // strip fences
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const data = JSON.parse(s);
  if (!Array.isArray(data)) throw new Error('not an array');
  return data;
}

function hermesTranslate(lang, strings, opts) {
  const prompt = buildPrompt(lang, strings);
  const promptFile = path.join(CACHE_DIR, `_prompt_${lang}_${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');
  const args = ['-z', prompt, '--yolo'];
  if (opts.model) {
    args.push('-m', opts.model);
  }
  let stdout = '';
  try {
    stdout = execFileSync('hermes', args, {
      encoding: 'utf8',
      timeout: opts.timeoutSec * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, HERMES_QUIET: '1' },
    });
  } catch (e) {
    const errOut = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    throw new Error(`hermes failed: ${errOut.slice(0, 500)}`);
  } finally {
    try {
      fs.unlinkSync(promptFile);
    } catch {
      /* ignore */
    }
  }
  // hermes may wrap with logs — take last JSON array-looking chunk
  const lines = stdout.split(/\n/);
  // try full extract first
  try {
    return extractJsonArray(stdout);
  } catch {
    // try from bottom
    for (let i = lines.length - 1; i >= 0; i--) {
      const slice = lines.slice(i).join('\n');
      if (!slice.includes('[')) continue;
      try {
        return extractJsonArray(slice);
      } catch {
        /* continue */
      }
    }
    throw new Error(`Could not parse hermes JSON. Tail:\n${stdout.slice(-800)}`);
  }
}

function applyTranslations(lang, enToTr) {
  // enToTr: Map or object en -> tr
  const map = enToTr instanceof Map ? enToTr : new Map(Object.entries(enToTr));
  let applied = 0;
  for (const file of listNsFiles('en')) {
    const enObj = loadJson(path.join(LOCALES, 'en', file));
    const tgtPath = path.join(LOCALES, lang, file);
    const tgtObj = fs.existsSync(tgtPath) ? loadJson(tgtPath) : structuredClone(enObj);
    let dirty = false;
    for (const [parts, enVal] of walkLeaves(enObj)) {
      if (isSkippable(enVal)) {
        // ensure structure exists with en
        if (getAt(tgtObj, parts) === undefined) {
          setAt(tgtObj, parts, enVal);
          dirty = true;
        }
        continue;
      }
      const tr = map.get(enVal);
      if (!tr || typeof tr !== 'string') continue;
      if (!placeholdersOk(enVal, tr)) continue;
      if (tr === enVal) continue; // never apply identity "translations"
      const cur = getAt(tgtObj, parts);
      if (cur === tr) continue;
      setAt(tgtObj, parts, tr);
      dirty = true;
      applied++;
    }
    // Ensure full key parity: any missing path from en
    for (const [parts, enVal] of walkLeaves(enObj)) {
      if (getAt(tgtObj, parts) === undefined) {
        setAt(tgtObj, parts, enVal);
        dirty = true;
      }
    }
    if (dirty) writeJson(tgtPath, tgtObj);
  }
  return applied;
}

function uniqueStillEn(lang, cacheMap) {
  const { byEn, need } = collectNeed(lang);
  const unique = [];
  for (const [en] of byEn) {
    const cached = cacheMap[en];
    // Must be a real translation — identical EN in cache is not done
    if (
      cached &&
      cached !== en &&
      placeholdersOk(en, cached)
    ) {
      continue;
    }
    unique.push(en);
  }
  return { unique, need, byEn };
}

async function main() {
  const opts = parseArgs(process.argv);
  const lang = opts.lang;

  const st0 = statsFor(lang);
  console.log(
    `[${lang}] before: translated=${st0.translated} still=${st0.still} skip=${st0.skip} total=${st0.total} (~${st0.pct}% of translatable)`,
  );
  if (opts.statsOnly) process.exit(0);

  const cache = loadCache(lang);
  // seed cache from existing non-en leaves
  for (const file of listNsFiles('en')) {
    const enObj = loadJson(path.join(LOCALES, 'en', file));
    const tgtPath = path.join(LOCALES, lang, file);
    if (!fs.existsSync(tgtPath)) continue;
    const tgtObj = loadJson(tgtPath);
    for (const [parts, enVal] of walkLeaves(enObj)) {
      if (isSkippable(enVal)) continue;
      const cur = getAt(tgtObj, parts);
      if (typeof cur === 'string' && cur !== enVal && placeholdersOk(enVal, cur)) {
        if (!cache.map[enVal]) cache.map[enVal] = cur;
      }
    }
  }
  saveCache(cache);

  let { unique } = uniqueStillEn(lang, cache.map);
  console.log(`[${lang}] unique still-en to translate: ${unique.length} (cache size ${Object.keys(cache.map).length})`);

  if (opts.dryRun) {
    console.log(unique.slice(0, 20));
    process.exit(0);
  }

  // Apply cache first
  let applied = applyTranslations(lang, cache.map);
  console.log(`[${lang}] applied from cache: ${applied}`);

  unique = uniqueStillEn(lang, cache.map).unique;
  const batches = chunk(unique, opts.batch);
  const limit = opts.maxBatches > 0 ? Math.min(opts.maxBatches, batches.length) : batches.length;
  console.log(`[${lang}] batches: ${batches.length} (running ${limit}), batchSize=${opts.batch}`);

  for (let b = 0; b < limit; b++) {
    const batch = batches[b];
    console.log(`[${lang}] batch ${b + 1}/${limit} (n=${batch.length})…`);
    let rows;
    try {
      rows = hermesTranslate(lang, batch, opts);
    } catch (e) {
      console.error(`[${lang}] batch ${b + 1} FAILED:`, e.message || e);
      // save progress and exit non-zero so caller can retry
      saveCache(cache);
      applyTranslations(lang, cache.map);
      process.exit(3);
    }
    const byI = new Map();
    for (const row of rows) {
      if (row && typeof row === 'object' && Number.isFinite(Number(row.i))) {
        byI.set(Number(row.i), String(row.tr ?? ''));
      }
    }
    let ok = 0;
    let bad = 0;
    for (let i = 0; i < batch.length; i++) {
      const en = batch[i];
      const tr = byI.get(i);
      if (!tr || !placeholdersOk(en, tr)) {
        bad++;
        continue;
      }
      // reject if model returned empty or left English unchanged
      if (!tr.trim() || tr === en) {
        bad++;
        continue;
      }
      cache.map[en] = tr;
      ok++;
    }
    saveCache(cache);
    const nApp = applyTranslations(lang, cache.map);
    const st = statsFor(lang);
    console.log(
      `[${lang}] batch ${b + 1} ok=${ok} bad=${bad} applied=${nApp} | progress ~${st.pct}% (still ${st.still})`,
    );
  }

  // final apply + ensure parity for all en keys (missing → copy en)
  applyTranslations(lang, cache.map);
  for (const file of listNsFiles('en')) {
    const enObj = loadJson(path.join(LOCALES, 'en', file));
    const tgtPath = path.join(LOCALES, lang, file);
    const tgtObj = fs.existsSync(tgtPath) ? loadJson(tgtPath) : {};
    let dirty = false;
    for (const [parts, enVal] of walkLeaves(enObj)) {
      if (getAt(tgtObj, parts) === undefined) {
        setAt(tgtObj, parts, enVal);
        dirty = true;
      }
    }
    if (dirty) writeJson(tgtPath, tgtObj);
  }

  const st1 = statsFor(lang);
  console.log(
    `[${lang}] DONE translated=${st1.translated} still=${st1.still} (~${st1.pct}%) cache=${Object.keys(cache.map).length}`,
  );
  // exit 0 even if still remaining (caller may loop)
  if (st1.still > 50 && st1.pct < 95) process.exit(4);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
