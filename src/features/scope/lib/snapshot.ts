import type {
  CircuitDocument,
  DelayModel,
  GateNode,
  ScopeRunResult,
  StimulusVector,
} from "../../../shared/types";
import { cloneDocument } from "../../../shared/document";

/** 一次示波器运行所绑定的不可变电路版本 */
export interface ScopeSnapshot {
  /** 单调版本号标签，如 v1、v2 */
  versionId: string;
  createdAt: number;
  name: string;
  /** 电路内容指纹；内容不变则指纹不变，可复用同一版本 */
  fingerprint: string;
  document: CircuitDocument;
}

/** 波形导出文件，完整保留激励、时间单位与延迟模型 */
export interface ScopeExportFile {
  format: "logic-lab-scope";
  formatVersion: 1;
  exportedAt: string;
  timeUnit: string;
  delayModel: DelayModel;
  stimulus: StimulusVector[];
  circuit: {
    versionId: string;
    name: string;
    fingerprint: string;
    document: CircuitDocument;
  };
  result: ScopeRunResult;
}

/** 参与指纹计算的元件字段（含延迟，延迟调整即产生新版本） */
function fingerprintNode(node: GateNode): unknown {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    x: node.x,
    y: node.y,
    value: node.value,
    riseDelay: node.riseDelay ?? null,
    fallDelay: node.fallDelay ?? null,
  };
}

/** 稳定的电路内容指纹：与元件/连线排列顺序解耦，仅由内容决定 */
export function documentFingerprint(document: CircuitDocument): string {
  const payload = {
    name: document.name,
    targetId: document.targetId,
    nodes: document.nodes
      .map(fingerprintNode)
      .sort((a, b) =>
        String((a as GateNode).id).localeCompare(String((b as GateNode).id)),
      ),
    wires: document.wires
      .map((wire) => ({ from: wire.from, to: wire.to }))
      .sort((a, b) =>
        `${a.from.nodeId}:${a.from.port}->${a.to.nodeId}:${a.to.port}`.localeCompare(
          `${b.from.nodeId}:${b.from.port}->${b.to.nodeId}:${b.to.port}`,
        ),
      ),
  };
  let hash = 2166136261;
  const text = JSON.stringify(payload);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface SnapshotStore {
  snapshots: ScopeSnapshot[];
  nextVersion: number;
}

/**
 * 依据当前电路取得快照：内容指纹与最新版本一致时复用该版本，
 * 否则深拷贝生成新版本，保证运行中的旧实验始终绑定旧电路。
 */
export function snapshotFor(
  store: SnapshotStore,
  document: CircuitDocument,
): ScopeSnapshot {
  const fingerprint = documentFingerprint(document);
  const existing = store.snapshots.find((item) => item.fingerprint === fingerprint);
  if (existing) return existing;
  const versionId = `v${store.nextVersion}`;
  const snapshot: ScopeSnapshot = {
    versionId,
    createdAt: Date.now(),
    name: document.name,
    fingerprint,
    document: cloneDocument(document),
  };
  store.nextVersion += 1;
  store.snapshots.unshift(snapshot);
  if (store.snapshots.length > 20) store.snapshots.length = 20;
  return snapshot;
}

export function encodeScopeExport(file: ScopeExportFile): string {
  return JSON.stringify(file, null, 2);
}
