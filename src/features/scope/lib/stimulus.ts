import type { CircuitDocument, StimulusVector } from "../../../shared/types";

export interface TimeUnit {
  id: string;
  label: string;
  symbol: string;
}

export const TIME_UNITS: readonly TimeUnit[] = [
  { id: "ns", label: "纳秒", symbol: "ns" },
  { id: "us", label: "微秒", symbol: "μs" },
  { id: "ms", label: "毫秒", symbol: "ms" },
  { id: "t", label: "时间单位", symbol: "t" },
];

export interface StimulusIssue {
  index: number;
  message: string;
}

/** 为当前输入元件生成一份缺省激励：t=0 保持初值，t=20 全部翻转 */
export function defaultStimulus(document: CircuitDocument): StimulusVector[] {
  const inputs = document.nodes.filter((node) => node.kind === "INPUT");
  if (!inputs.length) return [];
  return [
    { time: 0, values: Object.fromEntries(inputs.map((n) => [n.id, n.value])) },
    {
      time: 20,
      values: Object.fromEntries(inputs.map((n) => [n.id, n.value === 0 ? 1 : 0])),
    },
  ];
}

/**
 * 校验并规整激励文本/条目：
 * - 时间必须为非负有限数；
 * - 同一时刻的多路变化合并为一条向量；
 * - 仅保留当前电路中存在的输入元件；
 * - 按时间升序排列，返回问题清单以便界面标红。
 */
export function normalizeStimulus(
  document: CircuitDocument,
  rows: StimulusVector[],
): { vectors: StimulusVector[]; issues: StimulusIssue[] } {
  const inputIds = new Set(
    document.nodes.filter((n) => n.kind === "INPUT").map((n) => n.id),
  );
  const merged = new Map<number, StimulusVector>();
  const issues: StimulusIssue[] = [];
  rows.forEach((row, index) => {
    if (!Number.isFinite(row.time) || row.time < 0) {
      issues.push({ index, message: "时间必须为不小于 0 的数字" });
      return;
    }
    const time = Number(row.time);
    const values: Record<string, 0 | 1> = {};
    for (const [id, value] of Object.entries(row.values)) {
      if (inputIds.has(id) && (value === 0 || value === 1)) values[id] = value;
    }
    const existing = merged.get(time);
    if (existing) Object.assign(existing.values, values);
    else merged.set(time, { time, values });
  });
  const vectors = [...merged.values()].sort((a, b) => a.time - b.time);
  return { vectors, issues };
}

/** 把激励渲染为可编辑的多行文本：每行 `时间 输入=值 输入=值` */
export function stimulusToText(
  document: CircuitDocument,
  vectors: StimulusVector[],
): string {
  const inputs = document.nodes.filter((n) => n.kind === "INPUT");
  return vectors
    .map((vector) => {
      const assignments = inputs
        .filter((node) => Object.hasOwn(vector.values, node.id))
        .map((node) => `${node.label}=${vector.values[node.id]}`)
        .join(" ");
      return `${vector.time}${assignments ? ` ${assignments}` : ""}`;
    })
    .join("\n");
}

/** 解析激励文本，失败时返回错误信息；标签重复或缺失时报错 */
export function parseStimulusText(
  document: CircuitDocument,
  text: string,
): { vectors: StimulusVector[]; error: string | null } {
  const inputs = document.nodes.filter((n) => n.kind === "INPUT");
  const byLabel = new Map<string, string>();
  for (const node of inputs) {
    if (byLabel.has(node.label))
      return { vectors: [], error: `输入元件标签重复：${node.label}` };
    byLabel.set(node.label, node.id);
  }
  const rows: StimulusVector[] = [];
  const lines = text.split("\n");
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    const time = Number(tokens[0]);
    if (!Number.isFinite(time) || time < 0)
      return { vectors: [], error: `第 ${lineNo + 1} 行：时间必须为不小于 0 的数字` };
    const values: Record<string, 0 | 1> = {};
    for (const token of tokens.slice(1)) {
      const match = /^([^=]+)=([01])$/.exec(token);
      if (!match)
        return { vectors: [], error: `第 ${lineNo + 1} 行：“${token}”不是 标签=0/1 形式` };
      const id = byLabel.get(match[1].trim());
      if (!id)
        return { vectors: [], error: `第 ${lineNo + 1} 行：找不到输入 ${match[1].trim()}` };
      values[id] = Number(match[2]) as 0 | 1;
    }
    rows.push({ time, values });
  }
  const { vectors, issues } = normalizeStimulus(document, rows);
  if (issues.length)
    return { vectors, error: issues.map((i) => i.message).join("；") };
  return { vectors, error: null };
}
