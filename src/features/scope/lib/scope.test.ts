import test from "node:test";
import assert from "node:assert/strict";
import {
  documentFingerprint,
  snapshotFor,
  encodeScopeExport,
  type SnapshotStore,
} from "./snapshot";
import {
  normalizeStimulus,
  parseStimulusText,
  defaultStimulus,
} from "./stimulus";
import type { CircuitDocument, StimulusVector } from "../../../shared/types";

function doc(): CircuitDocument {
  return {
    version: 1,
    name: "d",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 0, y: 0 },
      { id: "g", kind: "AND", label: "G", value: 0, x: 20, y: 20, riseDelay: 10 },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 40, y: 40 },
    ],
    wires: [],
  };
}

test("指纹与元件排列顺序无关，内容相同则复用同一版本", () => {
  const d1 = doc();
  const d2 = doc();
  d2.nodes = [...d2.nodes].reverse();
  assert.equal(documentFingerprint(d1), documentFingerprint(d2));

  const store: SnapshotStore = { snapshots: [], nextVersion: 1 };
  const s1 = snapshotFor(store, d1);
  const s2 = snapshotFor(store, d2);
  assert.equal(s1.versionId, "v1");
  assert.equal(s2.versionId, "v1"); // 同内容复用
  assert.equal(store.snapshots.length, 1);
});

test("修改延迟会产生新版本，旧快照保持不变可继续观察", () => {
  const store: SnapshotStore = { snapshots: [], nextVersion: 1 };
  const d1 = doc();
  const old = snapshotFor(store, d1);
  const d2 = doc();
  d2.nodes[1].riseDelay = 25;
  const next = snapshotFor(store, d2);
  assert.notEqual(old.versionId, next.versionId);
  assert.equal(next.versionId, "v2");
  // 旧版本快照里的延迟仍是原值
  assert.equal(
    old.document.nodes.find((n) => n.id === "g")?.riseDelay,
    10,
  );
  assert.equal(
    next.document.nodes.find((n) => n.id === "g")?.riseDelay,
    25,
  );
});

test("同一时刻的多路输入变化合并为一条激励向量", () => {
  const d = doc();
  const rows: StimulusVector[] = [
    { time: 5, values: { a: 1 } },
    { time: 5, values: { a: 0 } },
    { time: 12, values: { a: 1 } },
  ];
  const { vectors, issues } = normalizeStimulus(d, rows);
  assert.equal(issues.length, 0);
  assert.deepEqual(
    vectors.map((v) => [v.time, v.values.a]),
    [[5, 0], [12, 1]],
  );
});

test("激励文本解析支持同刻多路与注释，拒绝非法行", () => {
  const d = doc();
  const ok = parseStimulusText(d, "# 注释\n5 A=1\n12 A=0");
  assert.equal(ok.error, null);
  assert.deepEqual(
    ok.vectors.map((v) => [v.time, v.values.a]),
    [[5, 1], [12, 0]],
  );
  const bad = parseStimulusText(d, "x A=1");
  assert.ok(bad.error?.includes("时间"));
  const unknown = parseStimulusText(d, "5 Z=1");
  assert.ok(unknown.error?.includes("找不到输入"));
});

test("默认激励覆盖全部输入且包含 t=0", () => {
  const d = doc();
  const stimulus = defaultStimulus(d);
  assert.equal(stimulus[0].time, 0);
  assert.equal(stimulus[0].values.a, 0);
});

test("导出文件保留激励、时间单位与延迟模型", () => {
  const store: SnapshotStore = { snapshots: [], nextVersion: 1 };
  const snapshot = snapshotFor(store, doc());
  const file = encodeScopeExport({
    format: "logic-lab-scope",
    formatVersion: 1,
    exportedAt: "2026-11-23T00:00:00.000Z",
    timeUnit: "ns",
    delayModel: "inertial",
    stimulus: [{ time: 5, values: { a: 1 } }],
    circuit: {
      versionId: snapshot.versionId,
      name: snapshot.name,
      fingerprint: snapshot.fingerprint,
      document: snapshot.document,
    },
    result: {
      traces: {},
      stepTimes: [],
      advanceTimes: [],
      stimulusTimes: [5],
      computedUntil: 5,
      complete: true,
      truncated: null,
    },
  });
  const parsed = JSON.parse(file);
  assert.equal(parsed.timeUnit, "ns");
  assert.equal(parsed.delayModel, "inertial");
  assert.deepEqual(parsed.stimulus, [{ time: 5, values: { a: 1 } }]);
  assert.equal(parsed.circuit.versionId, "v1");
});
