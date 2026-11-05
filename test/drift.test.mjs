import { profilePlugin } from '../lib/profile.mjs';
import { diffProfiles, renderDrift } from '../lib/drift.mjs';

let bad = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mkPlugin(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
  for (const [name, content] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  return dir;
}

// 1) 画像稳定：同一目录跑两次结果一样
{
  const dir = mkPlugin({
    'package.json': JSON.stringify({ name: 'p', version: '1.0.0', scripts: { postinstall: 'node install.js' } }),
    'lib/index.js': 'import cp from "node:child_process"; const r = await fetch("https://api.example.com/x");',
  });
  const a = profilePlugin(dir);
  const b = profilePlugin(dir);
  ok(JSON.stringify(a) === JSON.stringify(b), '画像稳定（两次一致）');
  ok(a.hooks.includes('postinstall'), '识别安装期脚本');
  ok(a.apis.includes('child_process'), '识别 child_process');
  ok(a.hosts.includes('https://api.example.com'), '识别外联域名', a.hosts.join(','));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 2) 升级后新增 shell → high
{
  const v1 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p', version: '1.0.0' }), 'lib/a.js': 'export const x = 1;' });
  const v2 = mkPlugin({
    'package.json': JSON.stringify({ name: 'p', version: '2.0.0' }),
    'lib/a.js': 'export const x = 1;',
    'lib/b.js': 'import cp from "node:child_process"; cp.execSync("whoami");',
  });
  const d = diffProfiles(profilePlugin(v1), profilePlugin(v2));
  ok(d.drifted && d.severity === 'high', '新增 shell → high', d.severity);
  ok(d.summary.some((s) => s.includes('execSync')), '列出新增的 API');
  const txt = renderDrift('p', '1.0.0', '2.0.0', d);
  ok(/🔴/.test(txt) && /重新审/.test(txt), '渲染里带红色标记与建议');
  fs.rmSync(v1, { recursive: true, force: true });
  fs.rmSync(v2, { recursive: true, force: true });
}

// 3) 只减少能力 → 不报警
{
  const v1 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p' }), 'a.js': 'cp.execSync("x")' });
  const v2 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p' }), 'a.js': 'export const y = 2' });
  const d = diffProfiles(profilePlugin(v1), profilePlugin(v2));
  ok(!d.drifted && d.severity === 'none', '能力减少不报警');
  const txt = renderDrift('p', '1', '2', d);
  ok(/没有变化/.test(txt), '渲染说没变化');
  fs.rmSync(v1, { recursive: true, force: true });
  fs.rmSync(v2, { recursive: true, force: true });
}

// 4) 新增安装期脚本 + 凭据路径 → high
{
  const v1 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p' }) });
  const v2 = mkPlugin({
    'package.json': JSON.stringify({ name: 'p', scripts: { postinstall: 'node x.js' } }),
    'x.js': 'const p = process.env.HOME + "/.ssh/id_rsa"; const t = "api_key";',
  });
  const d = diffProfiles(profilePlugin(v1), profilePlugin(v2));
  ok(d.severity === 'high', '新增 hook + 凭据 → high', d.severity);
  ok(d.added.hooks.includes('postinstall'), '记录新增 hook');
  ok(d.added.credPaths.length > 0, '记录新增凭据路径', d.added.credPaths.join(','));
  fs.rmSync(v1, { recursive: true, force: true });
  fs.rmSync(v2, { recursive: true, force: true });
}

// 5) 新增外联域名 → medium
{
  const v1 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p' }), 'a.js': 'export const z = 1;' });
  const v2 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p' }), 'a.js': 'fetch("https://tracker.evil.dev/ping")' });
  const d = diffProfiles(profilePlugin(v1), profilePlugin(v2));
  ok(d.severity === 'medium' && d.added.hosts.length === 1, '新增域名 → medium', d.severity);
  fs.rmSync(v1, { recursive: true, force: true });
  fs.rmSync(v2, { recursive: true, force: true });
}

// 6) 版本号变化但能力不变 → 不报警
{
  const v1 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p', version: '1.0.0' }), 'a.js': 'export const a = 1' });
  const v2 = mkPlugin({ 'package.json': JSON.stringify({ name: 'p', version: '1.0.1' }), 'a.js': 'export const a = 1' });
  const d = diffProfiles(profilePlugin(v1), profilePlugin(v2));
  ok(!d.drifted, '只改版本号不算漂移');
  fs.rmSync(v1, { recursive: true, force: true });
  fs.rmSync(v2, { recursive: true, force: true });
}

console.log(bad === 0 ? '\n✅ 能力漂移检测全部符合预期' : `\n❌ ${bad} 项不符合`);
process.exit(bad === 0 ? 0 : 1);
