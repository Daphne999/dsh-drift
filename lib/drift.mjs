/**
 * drift.mjs —— 对比两次能力画像，只报"新增"。
 *
 * 设计原则：**只报新增能力**。删掉能力不值得报警（那是变安全了），
 * 版本号变化也不算能力（那只是发布动作）。噪音来自"什么都报"，所以这里刻意窄。
 */
const SEVERITY = {
  hook: 'high', // 新增安装期脚本：最高危
  shell: 'high', // 新增命令执行
  eval: 'high', // 新增动态执行
  cred: 'high', // 新增凭据路径访问
  native: 'medium', // 新增原生依赖（二进制看不清）
  host: 'medium', // 新增外联域名
  write: 'medium', // 新增写文件
  other: 'low',
};

const HIGH_RISK_APIS = {
  child_process: 'shell',
  execSync: 'shell',
  spawnSync: 'shell',
  exec: 'shell',
  spawn: 'shell',
  eval: 'eval',
  new_Function: 'eval',
  vm: 'eval',
  rm_recursive: 'write',
  writeFile: 'write',
  registry_write: 'write',
  autostart: 'write',
};

const diffList = (a = [], b = []) => {
  const setA = new Set(a);
  return b.filter((x) => !setA.has(x));
};

/**
 * @param {object} base 旧画像
 * @param {object} next 新画像
 * @returns {{drifted:boolean, added:object, severity:string, summary:string[]}}
 */
export function diffProfiles(base, next) {
  const added = {
    hooks: diffList(base.hooks, next.hooks),
    apis: diffList(base.apis, next.apis),
    hosts: diffList(base.hosts, next.hosts),
    credPaths: diffList(base.credPaths, next.credPaths),
    nativeDeps: diffList(base.nativeDeps, next.nativeDeps),
  };

  const summary = [];
  let severity = 'none';

  const bump = (s) => {
    const order = ['none', 'low', 'medium', 'high'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  for (const h of added.hooks) {
    summary.push(`新增安装期脚本 ${h}`);
    bump(SEVERITY.hook);
  }
  for (const a of added.apis) {
    const kind = HIGH_RISK_APIS[a] ?? 'other';
    summary.push(`新增能力 ${a}`);
    bump(SEVERITY[kind] ?? 'low');
  }
  for (const c of added.credPaths) {
    summary.push(`新增凭据路径访问 ${c}`);
    bump(SEVERITY.cred);
  }
  for (const n of added.nativeDeps) {
    summary.push(`新增原生依赖 ${n}`);
    bump(SEVERITY.native);
  }
  for (const h of added.hosts) {
    summary.push(`新增外联域名 ${h}`);
    bump(SEVERITY.host);
  }

  const drifted = summary.length > 0;
  return { drifted, added, severity: drifted ? severity : 'none', summary };
}

/** 人话版结论 */
export function renderDrift(name, fromVer, toVer, diff) {
  if (!diff.drifted) {
    return `✅ ${name} ${fromVer} → ${toVer}：能力没有变化`;
  }
  const icon = diff.severity === 'high' ? '🔴' : diff.severity === 'medium' ? '🟠' : '🟡';
  return [
    `${icon} ${name} ${fromVer} → ${toVer}：新增了 ${diff.summary.length} 项能力（${diff.severity}）`,
    ...diff.summary.map((s) => `   · ${s}`),
    '',
    '建议：新增了能力就该重新审一遍——升级不等于安全。',
  ].join('\n');
}
