import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation, valueAt, TimingEngine } from "./engine";
import type { CircuitDocument, StimulusVector } from "../../../shared/types";

function doc(): CircuitDocument {
  return {
    version: 1,
    name: "t",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 0, y: 0 },
      { id: "b", kind: "INPUT", label: "B", value: 0, x: 0, y: 0 },
      {
        id: "g",
        kind: "AND",
        label: "AND",
        value: 0,
        x: 0,
        y: 0,
        riseDelay: 10,
        fallDelay: 10,
      },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 0, y: 0 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "g", port: 0 } },
      { id: "w2", from: { nodeId: "b", port: 0 }, to: { nodeId: "g", port: 1 } },
      { id: "w3", from: { nodeId: "g", port: 0 }, to: { nodeId: "y", port: 0 } },
    ],
  };
}

test("传输延迟：窄脉冲原样传播，输出在 t+10 出现等宽脉冲", () => {
  const stimulus: StimulusVector[] = [
    { time: 0, values: { a: 0, b: 0 } },
    { time: 5, values: { a: 1, b: 1 } },
    { time: 8, values: { a: 0 } },
    { time: 15, values: { b: 0 } },
  ];
  const result = runSimulation(doc(), stimulus, "transport");
  const trace = result.traces.g.map((p) => [p.time, p.value] as const);
  // 上升事件 t=5 -> 15；下降事件 t=8 -> 18，3 单位窄脉冲保留
  assert.deepEqual(trace, [
    [0, 0],
    [15, 1],
    [18, 0],
  ]);
  assert.equal(result.complete, true);
});

test("惯性延迟：短于延迟的脉冲被滤除，输出保持稳定", () => {
  const stimulus: StimulusVector[] = [
    { time: 0, values: { a: 0, b: 0 } },
    { time: 5, values: { a: 1, b: 1 } }, // 事件排在 15
    { time: 12, values: { a: 0, b: 0 } }, // 15 前理想值已退回 0，替换为 22 的 0 事件
  ];
  const result = runSimulation(doc(), stimulus, "inertial");
  // t=22 的事件值 0 与当前物理态 0 相同 -> 丢弃，全程无毛刺
  assert.deepEqual(
    result.traces.g.map((p) => [p.time, p.value] as const),
    [[0, 0]],
  );
  // 对照：同样激励在传输模型下会出现 3 单位窄脉冲
  const transport = runSimulation(doc(), stimulus, "transport");
  assert.deepEqual(
    transport.traces.g.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [15, 1],
      [22, 0],
    ],
  );
});

test("惯性延迟：取消短脉冲不会删掉其后合法边沿", () => {
  const stimulus: StimulusVector[] = [
    { time: 0, values: { a: 0, b: 0 } },
    { time: 5, values: { a: 1, b: 1 } }, // 事件排在 15
    { time: 12, values: { a: 0 } }, // 15 前退回 -> 替换为 22 的 0 事件
    { time: 20, values: { a: 1, b: 1 } }, // 再次稳定为 1，事件排在 30
    { time: 50, values: { a: 0, b: 0 } }, // 合法下降 -> 60
  ];
  const result = runSimulation(doc(), stimulus, "inertial");
  const trace = result.traces.g.map((p) => [p.time, p.value] as const);
  // 短脉冲被滤除（无 15 处跳变），t=30 的合法上升与 t=60 的下降完整保留
  assert.deepEqual(trace, [
    [0, 0],
    [30, 1],
    [60, 0],
  ]);
});

test("同一时刻到达的事件不产生顺序相关毛刺", () => {
  // 两条路径延迟不同，但输入在同一时刻翻转：结果只由该时刻全部落齐后的
  // 理想值决定，与节点排列顺序无关。AND 汇合：初态 a=1 -> 两 NOT 均为 0。
  const circuit: CircuitDocument = {
    version: 1,
    name: "merge",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 1, x: 0, y: 0 },
      {
        id: "p1",
        kind: "NOT",
        label: "N1",
        value: 0,
        x: 0,
        y: 0,
        riseDelay: 5,
        fallDelay: 5,
      },
      {
        id: "p2",
        kind: "NOT",
        label: "N2",
        value: 0,
        x: 0,
        y: 0,
        riseDelay: 15,
        fallDelay: 15,
      },
      {
        id: "o",
        kind: "AND",
        label: "AND",
        value: 0,
        x: 0,
        y: 0,
        riseDelay: 2,
        fallDelay: 2,
      },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 0, y: 0 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "p1", port: 0 } },
      { id: "w2", from: { nodeId: "a", port: 0 }, to: { nodeId: "p2", port: 0 } },
      { id: "w3", from: { nodeId: "p1", port: 0 }, to: { nodeId: "o", port: 0 } },
      { id: "w4", from: { nodeId: "p2", port: 0 }, to: { nodeId: "o", port: 1 } },
      { id: "w5", from: { nodeId: "o", port: 0 }, to: { nodeId: "y", port: 0 } },
    ],
  };
  // a 在 t=10 翻 0：p1 在 15 变 1，p2 在 25 变 1。
  // AND 逐门累加延迟：15 时输入变为 (1,0) 仍为 0（无跳变），25 时两输入
  // 都为 1，AND 在 27 上升；中间不产生任何顺序相关毛刺。
  const stimulus: StimulusVector[] = [
    { time: 0, values: { a: 1 } },
    { time: 10, values: { a: 0 } },
  ];
  const result = runSimulation(circuit, stimulus, "transport");
  assert.deepEqual(
    result.traces.p1.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [15, 1],
    ],
  );
  assert.deepEqual(
    result.traces.p2.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [25, 1],
    ],
  );
  assert.deepEqual(
    result.traces.o.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [27, 1],
    ],
  );
  assert.deepEqual(
    result.traces.y.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [27, 1],
    ],
  );
  // 打乱节点与连线排列顺序，波形必须完全一致
  const shuffled: CircuitDocument = {
    ...circuit,
    nodes: [...circuit.nodes].reverse(),
    wires: [...circuit.wires].reverse(),
  };
  const result2 = runSimulation(shuffled, stimulus, "transport");
  assert.deepEqual(result2.traces.o, result.traces.o);
  assert.deepEqual(result2.traces.y, result.traces.y);
});

test("停止计算时尾部保持 X，不被画成稳定值", () => {
  const stimulus: StimulusVector[] = [
    { time: 5, values: { a: 1, b: 1 } },
    { time: 30, values: { a: 0, b: 0 } },
  ];
  const engine = new TimingEngine(doc(), stimulus, "transport");
  engine.advance(); // t=5
  const partial = engine.result();
  assert.equal(partial.complete, false);
  assert.equal(partial.computedUntil, 5);
  // t=5 时门输出仍为初值 0（事件要到 15 才生效）
  assert.equal(valueAt(partial.traces.g, 5, partial.computedUntil), 0);
  // 晚于计算上界的查询必须是 X
  assert.equal(valueAt(partial.traces.g, 20, partial.computedUntil), "X");
});

test("上升/下降延迟可以分别设置", () => {
  const circuit = doc();
  circuit.nodes[2] = {
    ...circuit.nodes[2],
    riseDelay: 4,
    fallDelay: 9,
  } as (typeof circuit.nodes)[number];
  const stimulus: StimulusVector[] = [
    { time: 0, values: { a: 0, b: 0 } },
    { time: 2, values: { a: 1, b: 1 } },
    { time: 20, values: { a: 0 } },
  ];
  const result = runSimulation(circuit, stimulus, "transport");
  assert.deepEqual(
    result.traces.g.map((p) => [p.time, p.value] as const),
    [
      [0, 0],
      [6, 1],
      [29, 0],
    ],
  );
});
