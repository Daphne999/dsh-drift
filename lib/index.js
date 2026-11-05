/**
 * dsh-drift —— 插件能力漂移检测。
 *
 * 装之前扫一次不够：插件升级可能悄悄多出 shell、外联、凭据访问。
 * 这个插件存基线，之后每次检查只报"新增了什么能力"。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { profilePlugin } from './profile.mjs';
import { diffProfiles, renderDrift } from './drift.mjs';

export const name = 'dsh-drift';
export const inject = [];

export const Config = (Schema) =>
  Schema.object({
    storeDir: Schema.string().default(path.join(os.homedir(), '.dsh', 'drift', 'baselines')),
  });

const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

export function makeTools({ storeDir }) {
  const fileFor = (target) => path.join(storeDir, `${safe(target)}.json`);
  const load = (target) => {
    const f = fileFor(target);
    if (!fs.existsSync(f)) return null;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const save = (target, profile) => {
    fs.mkdirSync(storeDir, { recursive: true });
    const payload = { target, savedAt: new Date().toISOString(), profile };
    fs.writeFileSync(fileFor(target), JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  };

  return [
    {
      name: 'drift_baseline',
      description:
        'Record the current capability profile of a plugin directory as the baseline for drift checks. Call it right after you review a plugin, so later upgrades can be diffed against what you actually vetted.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'Plugin directory (or package root) to profile.' } },
        required: ['target'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: false },
        render: (_a, v) => [{ type: 'text', text: v?.report ?? '' }],
      },
      async execute(args) {
        const target = String(args?.target || '').trim();
        if (!target || !fs.existsSync(target)) return { ok: false, report: `目录不存在：${target}` };
        const profile = profilePlugin(target);
        save(target, profile);
        return {
          ok: true,
          report: [
            `✅ 已存基线：${profile.name ?? target} v${profile.version ?? '?'}`,
            `能力：hook ${profile.hooks.length} / API ${profile.apis.length} / 域名 ${profile.hosts.length} / 凭据 ${profile.credPaths.length} / 原生 ${profile.nativeDeps.length}`,
            `文件 ${profile.filesScanned} 个`,
          ].join('\n'),
        };
      },
    },
    {
      name: 'drift_check',
      description:
        'Compare a plugin directory against its stored baseline and report ONLY newly added capabilities (install hooks, shell/eval, outbound hosts, credential paths, native deps). Removed capabilities and version bumps are not reported.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'Plugin directory to check.' } },
        required: ['target'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: false },
        render: (_a, v) => [{ type: 'text', text: v?.report ?? '' }],
      },
      async execute(args) {
        const target = String(args?.target || '').trim();
        if (!target || !fs.existsSync(target)) return { ok: false, report: `目录不存在：${target}` };
        const base = load(target);
        if (!base) return { ok: false, report: `没有基线：${target}\n先跑 drift_baseline 存一次。` };
        const next = profilePlugin(target);
        const diff = diffProfiles(base.profile, next);
        return {
          ok: true,
          report: renderDrift(next.name ?? target, base.profile.version ?? '?', next.version ?? '?', diff),
        };
      },
    },
    {
      name: 'drift_list',
      description: 'List stored drift baselines with their plugin names and versions.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, report: { type: 'string' } }, required: ['ok', 'report'], additionalProperties: false },
        render: (_a, v) => [{ type: 'text', text: v?.report ?? '' }],
      },
      async execute() {
        if (!fs.existsSync(storeDir)) return { ok: true, report: '还没有任何基线。' };
        const rows = fs
          .readdirSync(storeDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => {
            try {
              const j = JSON.parse(fs.readFileSync(path.join(storeDir, f), 'utf8'));
              return `${j.profile?.name ?? j.target} v${j.profile?.version ?? '?'} — ${j.savedAt}`;
            } catch {
              return `${f}（损坏）`;
            }
          });
        return { ok: true, report: rows.length ? rows.join('\n') : '还没有任何基线。' };
      },
    },
  ];
}

export async function apply(ctx, config) {
  const storeDir = config?.storeDir ?? path.join(os.homedir(), '.dsh', 'drift', 'baselines');
  const tools = ctx.get('tools');
  if (!tools?.register) return;
  for (const t of makeTools({ storeDir })) tools.register(t);
}
