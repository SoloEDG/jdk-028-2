import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation, valueAt, TimingEngine } from "./engine";
import type { CircuitDocument, StimulusVector } from "../../../shared/types";

/**
 * 静态冒险演示电路：输入 a 分两条路径到 AND——
 * 慢路径 p1=¬a（延迟 6），快路径 n2a=¬a（2）再接 p2（2）得到 p2=a（总 4）。
 * a 由 0 翻 1 时，p2 在 t+4 先变 1、p1 在 t+6 才变 0，于是 AND 输入在
 * t+6~t+? 之间出现短暂的 (0→1) 错位，产生可解释的窄脉冲。
 */
function hazardCircuit(andDelay = 1): CircuitDocument {
  return {
    version: 1,
    name: "static-hazard",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 0, y: 0 },
      { id: "p1", kind: "NOT", label: "P1", value: 0, x: 0, y: 0, riseDelay: 6, fallDelay: 6 },
      { id: "n2a", kind: "NOT", label: "N2A", value: 0, x: 0, y: 0, riseDelay: 2, fallDelay: 2 },
      { id: "p2", kind: "NOT", label: "P2", value: 0, x: 0, y: 0, riseDelay: 2, fallDelay: 2 },
      { id: "and", kind: "AND", label: "AND", value: 0, x: 0, y: 0, riseDelay: andDelay, fallDelay: andDelay },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 0, y: 0 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "p1", port: 0 } },
      { id: "w2", from: { nodeId: "a", port: 0 }, to: { nodeId: "n2a", port: 0 } },
      { id: "w3", from: { nodeId: "n2a", port: 0 }, to: { nodeId: "p2", port: 0 } },
      { id: "w4", from: { nodeId: "p1", port: 0 }, to: { nodeId: "and", port: 0 } },
      { id: "w5", from: { nodeId: "p2", port: 0 }, to: { nodeId: "and", port: 1 } },
      { id: "w6", from: { nodeId: "and", port: 0 }, to: { nodeId: "y", port: 0 } },
    ],
  };
}

const flipUp: StimulusVector[] = [
  { time: 0, values: { a: 0 } },
  { time: 10, values: { a: 1 } },
];

test("传输模型逐门累加延迟并复现两路径错位产生的窄脉冲", () => {
  const r = runSimulation(hazardCircuit(1), flipUp, "transport");
  // a=0 初态：p1=1、p2=0、AND=0。
  assert.deepEqual(
    r.traces.p1.map((p) => [p.time, p.value] as const),
    [[0, 1], [16, 0]],
  );
  assert.deepEqual(
    r.traces.p2.map((p) => [p.time, p.value] as const),
    [[0, 0], [14, 1]],
  );
  // 14 时刻 AND 输入 (1,1) -> 输出在 15 上拉；16 时刻 p1 变 0 ->
  // AND 在 17 下拉，得到宽度 2 的正脉冲（15~17）。
  assert.deepEqual(
    r.traces.and.map((p) => [p.time, p.value] as const),
    [[0, 0], [15, 1], [17, 0]],
  );
  assert.deepEqual(
    r.traces.y.map((p) => [p.time, p.value] as const),
    [[0, 0], [15, 1], [17, 0]],
  );
});

test("惯性模型滤除短于门延迟的脉冲，传输模型保留它", () => {
  // AND 延迟 10 > 脉冲窗口 2：惯性模型到点同值丢弃，脉冲被完全滤除。
  const inertial = runSimulation(hazardCircuit(10), flipUp, "inertial");
  assert.deepEqual(
    inertial.traces.and.map((p) => [p.time, p.value] as const),
    [[0, 0]],
  );
  assert.equal(inertial.complete, true);
  // 同样延迟下传输模型保留 24 上拉、26 下拉的窄脉冲且仿真正常结束。
  const transport = runSimulation(hazardCircuit(10), flipUp, "transport");
  assert.deepEqual(
    transport.traces.and.map((p) => [p.time, p.value] as const),
    [[0, 0], [24, 1], [26, 0]],
  );
  assert.equal(transport.complete, true);
});

test("单步推进：每一步只暴露已计算时刻，未来查询为 X", () => {
  const engine = new TimingEngine(hazardCircuit(1), flipUp, "transport");
  const snapshots: Array<[number, string]> = [];
  while (engine.hasWork) {
    engine.advance();
    const r = engine.result();
    snapshots.push([
      r.computedUntil,
      String(valueAt(r.traces.y, r.computedUntil, r.computedUntil)),
    ]);
    assert.equal(
      valueAt(r.traces.y, r.computedUntil + 1, r.computedUntil),
      "X",
    );
  }
  assert.deepEqual(snapshots[0], [10, "0"]);
  assert.ok(snapshots.length >= 3);
});

test("切换延迟模型：同一激励重算，初态一致且传输事件不少于惯性", () => {
  const transport = runSimulation(hazardCircuit(3), flipUp, "transport");
  const inertial = runSimulation(hazardCircuit(3), flipUp, "inertial");
  const countEvents = (r: typeof transport) =>
    Object.values(r.traces).reduce((sum, trace) => sum + trace.length - 1, 0);
  assert.ok(countEvents(transport) >= countEvents(inertial));
  for (const id of Object.keys(transport.traces))
    assert.equal(
      transport.traces[id][0].value,
      inertial.traces[id][0].value,
    );
});

test("节点与连线排列顺序不影响任何一条波形", () => {
  const doc = hazardCircuit(1);
  const a = runSimulation(doc, flipUp, "transport");
  const shuffled: CircuitDocument = {
    ...doc,
    nodes: [...doc.nodes].reverse(),
    wires: [...doc.wires].reverse(),
  };
  const b = runSimulation(shuffled, flipUp, "transport");
  for (const id of Object.keys(a.traces))
    assert.deepEqual(b.traces[id], a.traces[id]);
});
