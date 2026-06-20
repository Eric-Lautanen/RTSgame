import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const SKIP_DIRS = new Set(['.git', 'node_modules']);
let errors = 0;
let warnings = 0;

// ─── Regex patterns ─────────────────────────────────────────────────────────
const IMPORT_NAMED_RE = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const IMPORT_DEFAULT_RE = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
const IMPORT_MIXED_RE = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const ALL_IMPORT_RE = /import\s+(?:\{([^}]*)\}|\w+)(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]([^'"]+)['"]/g;

const EXPORT_NAMED_RE = /export\s+(const|let|var|function|class|async\s+function)\s+(\w+)/g;
const EXPORT_BRACE_RE = /export\s+\{([^}]+)\}/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:function|class|const|let|var)?\s*(\w*)/g;

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) files.push(p);
  }
  return files;
}

function resolveImport(fromPath, spec) {
  if (!spec.startsWith('.')) return null;
  const d = dirname(fromPath);
  const candidates = [resolve(d, spec)];
  if (!candidates[0].endsWith('.js')) {
    candidates.push(candidates[0] + '.js');
    candidates.push(join(candidates[0], 'index.js'));
  }
  for (const c of candidates) {
    try { statSync(c); return c; } catch {}
  }
  return null;
}

function getExports(filePath) {
  const code = readFileSync(filePath, 'utf8');
  const ex = new Set();
  let m;
  while ((m = EXPORT_NAMED_RE.exec(code)) !== null) ex.add(m[2]);
  while ((m = EXPORT_BRACE_RE.exec(code)) !== null) {
    m[1].split(',').map(s => s.trim()).forEach(n => {
      const as = n.match(/\w+\s+as\s+(\w+)/);
      ex.add(as ? as[1] : n);
    });
  }
  while ((m = EXPORT_DEFAULT_RE.exec(code)) !== null) {
    if (m[1]) ex.add(m[1]);
    ex.add('default');
  }
  return ex;
}

function getRelativeImports(filePath) {
  const code = readFileSync(filePath, 'utf8');
  const imports = [];
  let m;
  while ((m = IMPORT_NAMED_RE.exec(code)) !== null) {
    if (m[2].startsWith('.')) imports.push(m[2]);
  }
  IMPORT_DEFAULT_RE.lastIndex = 0;
  while ((m = IMPORT_DEFAULT_RE.exec(code)) !== null) {
    if (m[2].startsWith('.')) imports.push(m[2]);
  }
  return imports;
}

// ─── 1. Gather files ────────────────────────────────────────────────────────
const files = walk(ROOT).filter(f => !f.includes('node_modules'));
const fileSet = new Set(files.map(f => f.toLowerCase()));
const relMap = {};
for (const f of files) {
  const rel = f.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
  relMap[f] = rel;
}

console.log(`\n Scanning ${files.length} file(s) ...\n`);

// ─── 2. Check imports & exports ─────────────────────────────────────────────
const importGraph = {};
for (const f of files) importGraph[f] = [];
const importedCount = {};

for (const f of files) {
  const rel = relMap[f];
  const code = readFileSync(f, 'utf8');
  const fileErrors = [];
  const fileWarnings = [];

  // Extract all import names from this file for unused-import checking
  const importNames = [];
  const namedImportRanges = [];

  ALL_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = ALL_IMPORT_RE.exec(code)) !== null) {
    const source = m[3] || m[4];
    if (!source || !source.startsWith('.')) continue;

    const namesPart = m[1] || m[2] || '';
    const names = namesPart.split(',').map(s => s.trim()).filter(Boolean);
    for (const n of names) {
      const clean = n.replace(/\s+as\s+\w+/, '').trim();
      if (clean) importNames.push(clean);
    }

    // Also capture default import name
    if (m[0].startsWith('import ') && !m[0].startsWith('import {')) {
      const defaultMatch = m[0].match(/import\s+(\w+)/);
      if (defaultMatch && defaultMatch[1]) importNames.push(defaultMatch[1]);
    }
  }

  // Check each import name is actually referenced in the file body
  for (const name of importNames) {
    if (name === 'default') continue;
    const bodyPart = code.replace(ALL_IMPORT_RE, ''); // remove all import lines
    if (!bodyPart.includes(name)) {
      fileWarnings.push(`  ⚠ Import '${name}' is never used in the file body`);
    }
  }

  // Verify each import
  ALL_IMPORT_RE.lastIndex = 0;
  let m2;
  while ((m2 = ALL_IMPORT_RE.exec(code)) !== null) {
    const source = m2[3] || m2[4];
    if (!source || !source.startsWith('.')) continue;

    const resolved = resolveImport(f, source);
    if (!resolved) {
      fileErrors.push(`  ✗ Import '${source}' → file not found`);
      continue;
    }

    importGraph[f].push(resolved);
    importedCount[resolved] = (importedCount[resolved] || 0) + 1;

    const targetExports = getExports(resolved);
    const names = (m2[1] || m2[2] || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const n of names) {
      const clean = n.replace(/\s+as\s+\w+/, '').trim();
      if (!targetExports.has(clean)) {
        fileWarnings.push(`  ⚠ Import '${clean}' from '${source}' → not found in exports of '${relMap[resolved] || source}'`);
      }
    }
  }

  // Detect bare module scripts (no import/export)
  if (!code.includes('import ') && !code.includes('export ')) {
    fileWarnings.push('  ⚠ No import or export — not an ES module');
  }

  // Check for console.log in production code (allow in validate.mjs itself)
  if (!f.endsWith('validate.mjs') && code.match(/console\.(log|debug|warn|error)\s*\(/)) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/console\.(log|debug)\s*\(/) && !lines[i].match(/console\.(error|warn)/) && !lines[i].includes('//')) {
        fileWarnings.push(`  ⚠ Line ${i + 1}: console.log/debug call (left in from development?)`);
      }
    }
  }

  if (fileErrors.length || fileWarnings.length) {
    console.log(`\n${rel}:`);
    fileErrors.forEach(e => { console.log(e); errors++; });
    fileWarnings.forEach(w => { console.log(w); warnings++; });
  }
}

// ─── 3. Circular dependency detection ───────────────────────────────────────
const visiting = new Set();
const visited = new Set();

function detectCycle(node, path) {
  if (visiting.has(node)) {
    const cyclePath = path.slice(path.indexOf(node));
    console.log(`\n${relMap[node] || node}:`);
    console.log(`  ✗ Circular dependency: ${cyclePath.map(n => relMap[n] || n.split('/').pop()).join(' → ')}`);
    errors++;
    return;
  }
  if (visited.has(node)) return;
  visiting.add(node);
  path.push(node);
  for (const dep of (importGraph[node] || [])) {
    detectCycle(dep, [...path]);
  }
  visiting.delete(node);
  visited.add(node);
}

for (const f of files) detectCycle(f, []);

// ─── 4. Syntax validation ───────────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'validate-'));
try {
  for (const f of files) {
    const rel = relMap[f];
    const code = readFileSync(f, 'utf8');

    const lines = code.split('\n');
    const stripped = lines.map(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('import\t')) {
        return '';
      }
      return l.replace(/\bexport\s+/, '');
    }).join('\n');

    const tmpFile = join(tmpDir, rel.replace(/[/\\]/g, '_') + '.js');
    writeFileSync(tmpFile, stripped, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe', timeout: 5000 });
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : '';
      const msgMatch = stderr.match(/(\w+Error):\s*(.+)/);
      console.log(`\n${rel}:`);
      console.log(`  ✗ ${msgMatch ? msgMatch[2] : stderr.split('\n').filter(Boolean)[0] || 'Parse error'}`);
      errors++;
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }
} finally {
  try { unlinkSync(tmpDir); } catch {}
}

// ─── 5. Project integrity checks ────────────────────────────────────────────

// 5a. Check favicon
const faviconPath = join(ROOT, 'favicon.svg');
try {
  statSync(faviconPath);
} catch {
  console.log(`\nfavicon.svg:`);
  console.log(`  ✗ Missing favicon.svg — browser will 404`);
  errors++;
}

// 5b. Verify index.html references valid files
const htmlPath = join(ROOT, 'index.html');
try {
  const html = readFileSync(htmlPath, 'utf8');

  // Check favicon link exists
  if (!html.includes('href="favicon.svg"') && !html.includes("href='favicon.svg'")) {
    console.log(`\nindex.html:`);
    console.log(`  ⚠ No <link rel="icon"> pointing to favicon.svg`);
    warnings++;
  }

  // Check script src references an existing file
  const scriptMatch = html.match(/<script\s+[^>]*src="([^"]+)"/);
  if (scriptMatch) {
    const scriptSrc = scriptMatch[1];
    const scriptPath = resolve(ROOT, scriptSrc);
    try {
      statSync(scriptPath);
    } catch {
      console.log(`\nindex.html:`);
      console.log(`  ✗ Script src '${scriptSrc}' → file not found`);
      errors++;
    }
  }
} catch {
  console.log(`\nindex.html:`);
  console.log(`  ✗ index.html not found`);
  errors++;
}

// 5c. Check for duplicate entity IDs in save.js deserialization
for (const f of files) {
  if (!f.endsWith('save.js')) continue;
  const code = readFileSync(f, 'utf8');
  // Check that deserialize handles entity ID reset
  if (!code.includes('resetEntityId')) {
    console.log(`\n${relMap[f]}:`);
    console.log(`  ⚠ Deserialization may not reset entity IDs — consider importing and calling resetEntityId()`);
    warnings++;
  }
}

// ─── 6. Orphan file detection ───────────────────────────────────────────────
const ORPHAN_WATCH_DIRS = ['core', 'ui'];
for (const f of files) {
  const rel = relMap[f];
  if (importedCount[f]) continue;
  if (rel.endsWith('main.js') || rel.endsWith('validate.mjs') || rel.endsWith('favicon.svg')) continue;
  const topDir = rel.split(/[/\\]/)[0];
  if (!ORPHAN_WATCH_DIRS.includes(topDir)) continue;
  console.log(`\n${rel}:`);
  console.log(`  ⚠ Orphan file — never imported by any other file`);
  warnings++;
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(44)}`);
console.log(` Files: ${files.length}  |  Errors: ${errors}  |  Warnings: ${warnings}`);
if (errors === 0 && warnings === 0) {
  console.log(' ✓ Everything looks good');
} else if (errors === 0) {
  console.log(' ⚠ Passes with warnings — review recommended');
} else {
  console.log(' ✗ Fix errors before continuing');
}
process.exit(errors > 0 ? 1 : 0);
