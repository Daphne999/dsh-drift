/**
 * profile.mjs —— 给一个插件目录做"能力画像"。
 *
 * 只提取**能力**，不评分：装了哪些威胁（hooks）、用了哪些危险 API、连了哪些域名、
 * 碰了哪些凭据路径、有没有原生依赖。
 * 画像要稳定（同样代码 → 同样输出），因为漂移检测靠它对比。
 */
import fs from 'node:fs';
import path from 'node:path';

const DANGEROUS_APIS = [
  ['child_process', /\bchild_process\b/],
  ['execSync', /\bexecSync\b/],
  ['spawnSync', /\bspawnSync\b/],
  ['exec', /\bexec\s*\(/],
  ['spawn', /\bspawn\s*\(/],
  ['eval', /\beval\s*\(/],
  ['new_Function', /new\s+Function\s*\(/],
  ['vm', /\brequire\(['"]vm['"]\)|from\s+['"]vm['"]/],
  ['net_listen', /\.listen\s*\(/],
  ['fetch', /\bfetch\s*\(/],
  ['https_request', /https?\.request\s*\(/],
  ['writeFile', /writeFile(Sync)?\s*\(/],
  ['rm_recursive', /rm(Sync)?\s*\([^)]*recursive|rmdir[^)]*recursive/],
  ['registry_write', /HKEY_|Registry\./],
  ['autostart', /Run\\|RunOnce|Startup/],
];

const CRED_HINTS = ['.ssh', '.env', 'credentials', '.aws', 'id_rsa', 'token', 'api_key', 'apikey'];

const HOST_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;

function walk(dir, root, out, limit = 400) {
  if (out.length >= limit) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist-build'].includes(e.name)) continue;
      walk(full, root, out, limit);
    } else if (/\.(js|mjs|cjs|ts|json)$/.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * @param {string} root 插件目录
 * @returns {object} 能力画像
 */
export function profilePlugin(root) {
  const pkgFile = path.join(root, 'package.json');
  const result = {
    root,
    name: null,
    version: null,
    hooks: [],
    nativeDeps: [],
    depCount: 0,
    apis: [],
    hosts: [],
    credPaths: [],
    filesScanned: 0,
  };

  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      result.name = pkg.name ?? null;
      result.version = pkg.version ?? null;
      const scripts = pkg.scripts ?? {};
      for (const k of ['preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall']) {
        if (typeof scripts[k] === 'string' && scripts[k].trim()) result.hooks.push(k);
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
      result.depCount = Object.keys(deps).length;
      for (const [n, v] of Object.entries(deps)) {
        if (/node-gyp|prebuild|\.node\b/i.test(String(v))) result.nativeDeps.push(n);
      }
    } catch {}
  }

  const files = [];
  walk(root, root, files);
  result.filesScanned = files.length;

  const apis = new Set();
  const hosts = new Set();
  const creds = new Set();

  for (const f of files) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    // 规则定义文件本身不算"使用"（避免扫描器扫自己时误报）
    const isRulesFile = /(^|[\\/])profile\.mjs$/.test(f);
    if (!isRulesFile) {
      for (const [name, re] of DANGEROUS_APIS) if (re.test(text)) apis.add(name);
      for (const h of text.match(HOST_RE) ?? []) hosts.add(h.toLowerCase());
      for (const c of CRED_HINTS) if (text.includes(c)) creds.add(c);
    }
  }

  result.apis = [...apis].sort();
  result.hosts = [...hosts].sort();
  result.credPaths = [...creds].sort();
  return result;
}
