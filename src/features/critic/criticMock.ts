import type { DocumentSnapshot } from '../../shared/types/document';
import type {
  CriticOptions,
  CriticReport,
  CriticFinding,
  CriticPlan,
} from '../../shared/types/critic';
import { textHash } from '../selection/editorAdapter';
import { writingProfileController } from '../settings/writingProfileController';
import { createWebMockManifest } from '../context/contextManifest';
const key = 'a2ui.web-mock.critic.v1.1';
const reports = (): CriticReport[] => JSON.parse(localStorage.getItem(key) ?? '[]');
const save = (r: CriticReport) => {
  localStorage.setItem(
    key,
    JSON.stringify([
      ...reports().filter(
        (v) =>
          !(
            JSON.stringify(v.binding.target) === JSON.stringify(r.binding.target) &&
            v.engine === r.engine
          )
      ),
      r,
    ])
  );
  return r;
};
const get = (id: string) => {
  const r = reports().find((v) => v.id === id);
  if (!r) throw Error('审稿记录已失效');
  return r;
};
const plans = new Map<string, { plan: CriticPlan; report: CriticReport; confirmed: boolean }>();
export const criticMock = {
  async inspect(snapshot: DocumentSnapshot, options: CriticOptions, workspaceId: string) {
    if (snapshot.hasUnsavedDraft) throw Error('请先保存正文');
    const profile = (await writingProfileController.get(workspaceId)).effective;
    const signature = await textHash(JSON.stringify([snapshot, options, profile.hash]));
    let local = reports().find((r) => r.engine === 'local' && r.signature === signature);
    if (!local) {
      const findings: CriticFinding[] = [];
      const add = (start: number, end: number, kind: string, message: string) =>
        findings.push({
          id: crypto.randomUUID(),
          start,
          end,
          line: snapshot.text.slice(0, start).split('\n').length,
          kind,
          message,
          quote: snapshot.text.slice(start, end),
          ignored: false,
          severity: 'suggestion',
          evidence: null,
        });
      let offset = 0,
        level = 0;
      const visible = snapshot.text.replace(
        /```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)|(`+)[^`]*?\1/g,
        (code) => code.replace(/[^\r\n]/g, ' ')
      );
      if (profile.enabled) {
        for (const word of profile.forbiddenWords) {
          if (!word) continue;
          let at = visible.indexOf(word);
          while (at >= 0) {
            const end = at + word.length;
            const bounded =
              !/^[\x00-\x7f]+$/.test(word) ||
              (!/[a-z0-9]/i.test(visible[at - 1] ?? '') && !/[a-z0-9]/i.test(visible[end] ?? ''));
            if (bounded)
              add(at, end, 'forbidden_word', `“${word}”列在禁用词中；若本次有意引用，请忽略。`);
            at = visible.indexOf(word, end);
          }
        }
      }
      const seen = new Set<string>();
      for (const para of snapshot.text.split('\n\n')) {
        const heading = /^(#{1,6})\s/.exec(para);
        if (heading) {
          if (heading[1].length > level + 1)
            add(offset, offset + para.length, 'heading', '标题层级存在跳级，请核对结构。');
          level = heading[1].length;
        } else if (para.trim()) {
          if (para.length > options.paragraphLimit)
            add(offset, offset + para.length, 'paragraph_length', '段落较长，可考虑拆分。');
          if (para.length > options.sentenceLimit && !/[。！？]/.test(para))
            add(offset, offset + para.length, 'sentence_length', '句子较长，可考虑拆句。');
          if (seen.has(para) && para.length >= 20)
            add(offset, offset + para.length, 'repetition', '与前文存在重复段落。');
          seen.add(para);
          if (/\d/.test(para) && !/\[S\d+\]/.test(para))
            add(
              offset,
              offset + para.length,
              'missing_citation',
              '本段含数字但没有可核验来源，请核对，不表示数字有误。'
            );
          if (profile.enabled)
            for (const t of profile.terminology) {
              const at = para.indexOf(t.term);
              if (at >= 0 && !para.slice(at).startsWith(t.preferred))
                add(
                  offset + at,
                  offset + at + t.term.length,
                  'terminology',
                  `写作偏好建议将“${t.term}”统一为“${t.preferred}”。`
                );
            }
        }
        offset += para.length + 2;
      }
      local = save({
        id: crypto.randomUUID(),
        engine: 'local',
        engineVersion: 'web-mock',
        binding: snapshot,
        signature,
        profileHash: profile.hash,
        options,
        findings: findings.slice(0, 100),
        truncated: findings.length > 100,
        createdAt: String(Date.now() / 1000),
      });
    }
    return {
      local,
      llm: reports().find((r) => r.engine === 'llm' && r.signature === signature) ?? null,
    };
  },
  async ignore(id: string, findingId: string, ignored: boolean) {
    const r = get(id);
    const f = r.findings.find((f) => f.id === findingId);
    if (!f) throw Error('提示已失效');
    f.ignored = ignored;
    return save(r);
  },
  async resolve(id: string, findingId: string) {
    const r = get(id),
      f = r.findings.find((f) => f.id === findingId && !f.ignored);
    if (!f) throw Error('提示已失效');
    return {
      selection: {
        target: r.binding.target,
        revisionId: r.binding.revisionId,
        contentHash: r.binding.contentHash,
        start: f.start,
        end: f.end,
        offsetUnit: 'utf16' as const,
        selectedTextHash: await textHash(f.quote),
      },
      instruction: `请核对审稿提示：${f.message}，保留事实。`,
    };
  },
  async plan(id: string, providerId: string) {
    const r = get(id);
    const manifest = createWebMockManifest(
      {
        workspaceId: 'web-mock-workspace',
        sessionId: crypto.randomUUID(),
        providerId,
        prompt: '只读审稿',
        candidates: [
          { kind: 'selection', label: '待审稿正文', selected: true, content: r.binding.text },
        ],
        includeRecentMessages: false,
        recentMessageCount: 0,
        contextPackIds: [],
      },
      'local'
    );
    const plan = { id: manifest.id, requestId: crypto.randomUUID(), manifest };
    plans.set(plan.id, { plan, report: r, confirmed: false });
    return plan;
  },
  async confirm(id: string) {
    const p = plans.get(id);
    if (!p) throw Error('计划已失效');
    p.confirmed = true;
  },
  async start(id: string) {
    const p = plans.get(id);
    if (!p?.confirmed) throw Error('请确认发送清单');
    plans.delete(id);
    return save({
      ...p.report,
      id: crypto.randomUUID(),
      engine: 'llm',
      engineVersion: 'web-mock',
      findings: [],
      createdAt: String(Date.now() / 1000),
    });
  },
  async cancel(id: string) {
    plans.delete(id);
  },
};
