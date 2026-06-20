import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn']);
let errors = 0;
let warnings = 0;

// Parse CLI args: --orphan-dirs=core,ui  or  --skip-dirs=.git,node_modules
const args = process.argv.slice(2);
function getArg(flag, def) {
  for (const a of args) {
    if (a.startsWith(flag + '=')) return a.slice(flag.length + 1).split(',').map(s => s.trim()).filter(Boolean);
  }
  return def;
}
const ORPHAN_WATCH_DIRS = new Set(getArg('--orphan-dirs', ['core', 'ui']));
args.filter(a => a.startsWith('--skip-dirs=')).forEach(a => {
  a.slice('--skip-dirs='.length).split(',').forEach(d => SKIP_DIRS.add(d.trim()));
});

const IMPORT_RE = /import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\)/g;
const EXPORT_NAMED_RE = /export\s+(const|let|var|function|class|async\s+function)\s+(\w+)/g;
const EXPORT_BRACE_RE = /export\s+\{([^}]+)\}/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:function|class|const|let|var)?\s*(\w*)/g;
const EXPORT_STAR_RE = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs') || e.name.endsWith('.cjs')) files.push(p);
  }
  return files;
}

function resolveImport(fromPath, spec) {
  if (!spec.startsWith('.')) return null;
  const d = dirname(fromPath);
  const candidates = [resolve(d, spec)];
  if (!candidates[0].endsWith('.js') && !candidates[0].endsWith('.mjs') && !candidates[0].endsWith('.cjs')) {
    candidates.push(candidates[0] + '.js');
    candidates.push(candidates[0] + '.mjs');
    candidates.push(candidates[0] + '.cjs');
    candidates.push(join(candidates[0], 'index.js'));
    candidates.push(join(candidates[0], 'index.mjs'));
    candidates.push(join(candidates[0], 'index.cjs'));
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
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
      const as = n.match(/\w+\s+as\s+(\w+)/);
      ex.add(as ? as[1] : n);
    });
  }
  while ((m = EXPORT_DEFAULT_RE.exec(code)) !== null) {
    if (m[1]) ex.add(m[1]);
    ex.add('default');
  }
  while ((m = EXPORT_STAR_RE.exec(code)) !== null) {
    const resolved = resolveImport(filePath, m[1]);
    if (resolved) {
      for (const e of getExports(resolved)) ex.add(e);
    }
  }
  return ex;
}

function stripCodeForSyntaxCheck(code) {
  const lines = code.split('\n');
  const result = [];
  let inImport = false;
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (inImport) {
      for (const ch of raw) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0 && (raw.includes(';') || raw.trim().endsWith(';') || raw.match(/from\s+['"`][^'"`]+['"`];?\s*$/))) {
        inImport = false;
      }
      result.push('');
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('import\t') || trimmed.startsWith('import;')) {
      if (!trimmed.includes(';') && !trimmed.match(/from\s+['"`][^'"`]+['"`];?\s*$/)) {
        inImport = true;
        braceDepth = 0;
        for (const ch of raw) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
      }
      result.push('');
      continue;
    }
    if (trimmed.startsWith('import.meta')) {
      result.push(raw);
      continue;
    }
    let line = raw;
    if (line.includes('export default') || line.includes('export\tdefault')) {
      line = line.replace(/\bexport\s+default\b/, '/* default */');
    }
    line = line.replace(/\bexport\s+/, '');
    result.push(line);
  }
  return result.join('\n');
}

const files = walk(ROOT).filter(f => !f.includes('node_modules'));
const relMap = {};
for (const f of files) {
  const rel = f.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
  relMap[f] = rel;
}

console.log(`\n Scanning ${files.length} file(s) ...\n`);

const importGraph = {};
for (const f of files) importGraph[f] = [];
const importedCount = {};

for (const f of files) {
  const rel = relMap[f];
  const code = readFileSync(f, 'utf8');
  const fileErrors = [];
  const fileWarnings = [];

  const importNames = [];

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const source = m[1] || m[2];
    if (!source || !source.startsWith('.')) continue;

    const resolved = resolveImport(f, source);
    if (!resolved) {
      fileErrors.push(`  ✗ Import '${source}' → file not found`);
      continue;
    }

    importGraph[f].push(resolved);
    importedCount[resolved] = (importedCount[resolved] || 0) + 1;

    // Extract named import names from the matched text before "from"
    const beforeFrom = m[0].split(/\s+from\s+/)[0];
    const braceMatch = beforeFrom.match(/\{([^}]*)\}/);
    if (braceMatch) {
      const names = braceMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const n of names) {
        const clean = n.replace(/\s+as\s+\w+/, '').trim();
        if (clean) importNames.push(clean);
      }
    }
    const defaultMatch = beforeFrom.match(/import\s+(\w+)/);
    if (defaultMatch && defaultMatch[1] && !defaultMatch[1].startsWith('{')) importNames.push(defaultMatch[1]);

    // Check exports match for named imports
    const targetExports = getExports(resolved);
    if (braceMatch) {
      const names = braceMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const n of names) {
        const clean = n.replace(/\s+as\s+\w+/, '').trim();
        if (!targetExports.has(clean)) {
          fileWarnings.push(`  ⚠ Import '${clean}' from '${source}' → not found in exports of '${relMap[resolved] || source}'`);
        }
      }
    }
  }

  for (const name of importNames) {
    if (name === 'default') continue;
    const bodyPart = code.replace(IMPORT_RE, '');
    let used = bodyPart.includes(name);
    if (!used && name.length > 2) {
      const lineWithRef = bodyPart.split('\n').some(l => l.includes(name));
      used = lineWithRef;
    }
    if (!used) {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp('\\b' + safe + '\\b').test(bodyPart)) {
        fileWarnings.push(`  ⚠ Import '${name}' is never used in the file body`);
      }
    }
  }

  if (!code.includes('import ') && !code.includes('export ') && !code.includes('require(') && !code.includes('require(')) {
    if (!code.includes('__dirname') && !code.includes('__filename') && !code.includes('require')) {
      fileWarnings.push('  ⚠ No import/export/require — not an ES/CommonJS module');
    }
  }

  if (!f.endsWith('validate.mjs') && code.match(/console\.(log|debug)\s*\(/)) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/console\.(log|debug)\s*\(/) && !lines[i].includes('//') && !lines[i].trim().startsWith('//')) {
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

const tmpDir = mkdtempSync(join(tmpdir(), 'validate-'));
try {
  for (const f of files) {
    const rel = relMap[f];
    const code = readFileSync(f, 'utf8');
    const stripped = stripCodeForSyntaxCheck(code);

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

const htmlPath = join(ROOT, 'index.html');
try {
  const html = readFileSync(htmlPath, 'utf8');
  const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
  if (iconMatch) {
    const iconPath = resolve(ROOT, iconMatch[1]);
    try { statSync(iconPath); } catch {
      console.log(`\nindex.html:`);
      console.log(`  ✗ Favicon '${iconMatch[1]}' → file not found`);
      errors++;
    }
  } else {
    console.log(`\nindex.html:`);
    console.log(`  ⚠ No <link rel="icon"> found`);
    warnings++;
  }

  const scriptTags = html.matchAll(/<script\s+[^>]*src="([^"]+)"[^>]*>/gi);
  if (scriptTags) {
    for (const st of scriptTags) {
      const scriptSrc = st[1];
      const scriptPath = resolve(ROOT, scriptSrc);
      try { statSync(scriptPath); } catch {
        console.log(`\nindex.html:`);
        console.log(`  ✗ Script src '${scriptSrc}' → file not found`);
        errors++;
      }
    }
  }

  const linkTags = html.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi);
  if (linkTags) {
    for (const lt of linkTags) {
      const href = lt[1];
      if (href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) continue;
      const absPath = resolve(ROOT, href);
      try { statSync(absPath); } catch {
        console.log(`\nindex.html:`);
        console.log(`  ⚠ Link href '${href}' → file not found`);
        warnings++;
      }
    }
  }
} catch {
  console.log(`\nindex.html:`);
  console.log(`  ✗ index.html not found`);
  errors++;
}

for (const f of files) {
  const rel = relMap[f];
  if (importedCount[f]) continue;
  if (rel.endsWith('main.js') || rel.endsWith('validate.mjs') || rel.endsWith('favicon.svg')) continue;
  const topDir = rel.split(/[/\\]/)[0];
  if (!ORPHAN_WATCH_DIRS.has(topDir)) continue;
  console.log(`\n${rel}:`);
  console.log(`  ⚠ Orphan file — never imported by any other file`);
  warnings++;
}

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
