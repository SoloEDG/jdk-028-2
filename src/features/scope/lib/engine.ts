import type {
  CircuitDocument,
  DelayModel,
  GateNode,
  ScopeRunResult,
  Signal,
  StimulusVector,
  TracePoint,
} from "../../../shared/types";
import { getSpec } from "../../catalog/lib/specs";
import { topologicalOrder } from "../../circuit/lib/graph";
import { gateValue } from "../../simulation/lib/logic";

/** 门电路缺省延迟（时间单位），输入/输出元件始终为理想导线（0） */
export const DEFAULT_GATE_DELAY = 10;
/** 单次仿真的事件处理安全上限，防止异常配置导致长循环 */
export const DEFAULT_MAX_EVENTS = 20000;

const isGate = (node: GateNode): boolean =>
  node.kind !== "INPUT" && node.kind !== "OUTPUT";

/** 读取元件沿向延迟；非法/缺省值回落到缺省门延迟，导线恒为 0 */
export function edgeDelay(node: GateNode, edge: 0 | 1): number {
  if (!isGate(node)) return 0;
  const raw = edge === 1 ? node.riseDelay : node.fallDelay;
  if (raw === undefined || !Number.isFinite(raw) || raw < 0)
    return DEFAULT_GATE_DELAY;
  return raw;
}

interface ScheduledEvent {
  time: number;
  value: 0 | 1;
}

/**
 * 事件驱动的时序仿真引擎。
 *
 * 每个时间点的处理顺序固定为：
 * 1. 落齐该时刻的全部外部激励与到点事件，更新物理态 current；
 * 2. 按拓扑顺序基于“已经传播到位”的物理输入逐个评估元件——零延迟
 *    元件立即生效，有延迟的门排定未来事件。
 * 因为第 1 步先把同一时刻的所有变化合并，第 2 步只读取稳定后的输入，
 * 所以同时到达的事件结果与元件排列顺序无关，不会产生顺序相关毛刺。
 *
 * 传输延迟（transport）：每个门维护按时间排序的事件队列，新事件删除
 * 时间不早于自身的旧事件后追加，窄脉冲在不同时刻各有事件，原样传播。
 *
 * 惯性延迟（inertial）：每个门至多保留一个未生效事件，新事件整体替换
 * 旧事件；到点时若事件值与当前物理态相同则丢弃，滤除短于延迟的脉冲，
 * 且不会连带删掉其后的合法边沿。
 */
export class TimingEngine {
  private readonly nodes = new Map<string, GateNode>();
  private readonly incoming = new Map<string, { port: number; from: string }[]>();
  private readonly order: string[];
  /** 物理态：事件到点后才更新，波形与线路只读取这里 */
  private readonly current = new Map<string, Signal>();
  /** time -> (nodeId -> 该时刻生效的物理输出值) */
  private readonly buckets = new Map<number, Map<string, 0 | 1>>();
  private readonly timeIndex: number[] = [];
  /** 每个门按时间排序的待生效事件（传输模型可含多项，惯性模型至多一项） */
  private readonly scheduled = new Map<string, ScheduledEvent[]>();
  private readonly traces: Record<string, TracePoint[]> = Object.create(null);
  private readonly stepTimes: number[] = [];
  private readonly advanceTimes: number[] = [];
  private readonly stimulusAt = new Map<number, Map<string, 0 | 1>>();
  private readonly stimulusTimes: number[] = [];
  private stimulusCursor = 0;
  private eventCount = 0;
  private now = 0;
  truncated: string | null = null;

  constructor(
    document: CircuitDocument,
    stimulus: StimulusVector[],
    private readonly model: DelayModel,
    private readonly maxEvents = DEFAULT_MAX_EVENTS,
  ) {
    for (const node of document.nodes) this.nodes.set(node.id, node);
    for (const node of document.nodes) this.incoming.set(node.id, []);
    for (const wire of document.wires) {
      const list = this.incoming.get(wire.to.nodeId);
      if (list) list.push({ port: wire.to.port, from: wire.from.nodeId });
    }
    this.order = topologicalOrder(document);
    for (const vector of stimulus) {
      const time = vector.time;
      if (!Number.isFinite(time) || time < 0) continue;
      let bucket = this.stimulusAt.get(time);
      if (!bucket) {
        bucket = new Map();
        this.stimulusAt.set(time, bucket);
        this.stimulusTimes.push(time);
      }
      for (const [id, value] of Object.entries(vector.values)) {
        if (this.nodes.get(id)?.kind === "INPUT") bucket.set(id, value);
      }
    }
    this.stimulusTimes.sort((a, b) => a - b);
    this.initialize();
  }

  private initialize(): void {
    const first = this.stimulusAt.get(0);
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (node.kind === "INPUT")
        this.current.set(id, first?.get(id) ?? node.value);
    }
    // t=0 做拓扑收敛得到自洽的物理初态。门节点文档中的 value 仅为占位，
    // 可能污染首轮读取，因此连续收敛两遍以确保多级路径初值正确
    //（悬空端口仍为 X）。
    for (let pass = 0; pass < 2; pass++)
      for (const id of this.order) {
        const node = this.nodes.get(id)!;
        if (node.kind === "INPUT") continue;
        this.current.set(id, this.idealOf(node));
      }
    for (const id of this.order)
      this.traces[id] = [{ time: 0, value: this.current.get(id) ?? "X" }];
    this.stimulusCursor = this.stimulusTimes[0] === 0 ? 1 : 0;
  }

  /** 基于当前物理态计算一个元件的理想输出。 */
  private idealOf(node: GateNode): Signal {
    const pins: Signal[] = Array.from(
      { length: getSpec(node.kind).inputs },
      (_, port) => {
        const link = this.incoming
          .get(node.id)!
          .find((item) => item.port === port);
        return link ? (this.current.get(link.from) ?? "X") : "X";
      },
    );
    return gateValue(node.kind, pins);
  }

  private insertTime(time: number): void {
    let lo = 0;
    const index = this.timeIndex;
    while (lo < index.length && index[lo] < time) lo++;
    if (index[lo] !== time) index.splice(lo, 0, time);
  }

  private removeTimeIfEmpty(time: number): void {
    const bucket = this.buckets.get(time);
    if (bucket && bucket.size === 0) {
      this.buckets.delete(time);
      const at = this.timeIndex.indexOf(time);
      if (at >= 0) this.timeIndex.splice(at, 1);
    }
  }

  private putInBucket(time: number, nodeId: string, value: 0 | 1): void {
    let bucket = this.buckets.get(time);
    // 同刻同值事件幂等，避免重复入队。
    if (bucket && bucket.get(nodeId) === value) return;
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(time, bucket);
      this.insertTime(time);
    }
    bucket.set(nodeId, value);
  }

  private removeFromBucket(time: number, nodeId: string): void {
    const bucket = this.buckets.get(time);
    if (!bucket) return;
    bucket.delete(nodeId);
    this.removeTimeIfEmpty(time);
  }

  /**
   * 让一个门的输出趋向 ideal（VHDL 信号赋值语义）。
   * 传输模型：先删除所有时间不早于 due 的旧事件，再把 ideal 与“保留
   * 事件的末值，若无则当前物理态”比较，相同则不追加；
   * 惯性模型：整体替换唯一的未生效事件，到点时再做同值丢弃实现滤波。
   */
  private reconcile(node: GateNode, ideal: 0 | 1): void {
    const list = this.scheduled.get(node.id) ?? [];
    // 已稳定：没有待生效事件且物理态已等于理想值，无需任何排程，
    // 否则惯性模型会在事件被滤波丢弃后不断重新排程，形成事件自循环。
    if (list.length === 0 && (this.current.get(node.id) ?? "X") === ideal)
      return;
    const due = this.now + edgeDelay(node, ideal);
    if (this.model === "transport") {
      // 删除时间不早于新事件的旧事件（VHDL transport 惯性截断）。
      let cut = list.length;
      while (cut > 0 && list[cut - 1].time >= due) cut--;
      for (let i = list.length - 1; i >= cut; i--)
        this.removeFromBucket(list[i].time, node.id);
      list.length = cut;
      const reference: Signal = cut
        ? list[cut - 1].value
        : (this.current.get(node.id) ?? "X");
      if (reference === ideal) return;
      list.push({ time: due, value: ideal });
      this.putInBucket(due, node.id, ideal);
    } else {
      if (list[0]?.value === ideal) return;
      for (const event of list) this.removeFromBucket(event.time, node.id);
      list.length = 0;
      list.push({ time: due, value: ideal });
      this.putInBucket(due, node.id, ideal);
    }
    this.scheduled.set(node.id, list);
  }

  /** 是否还有未施加的激励或未处理的事件。 */
  get hasWork(): boolean {
    return (
      this.stimulusCursor < this.stimulusTimes.length ||
      this.timeIndex.length > 0
    );
  }

  get time(): number {
    return this.now;
  }

  /**
   * 推进到下一个时间点并完成该时刻的全部传播，返回该时刻发生物理
   * 变化的节点 id；无工作可做时返回 null。
   */
  advance(): string[] | null {
    if (this.truncated || !this.hasWork) return null;
    const nextStimulus = this.stimulusTimes[this.stimulusCursor];
    const nextEvent = this.timeIndex[0];
    const t =
      nextStimulus === undefined
        ? nextEvent
        : nextEvent === undefined
          ? nextStimulus
          : Math.min(nextStimulus, nextEvent);
    this.now = t;
    this.advanceTimes.push(t);
    this.eventCount++;
    if (this.eventCount > this.maxEvents) {
      this.truncated = `已达到 ${this.maxEvents} 个事件的安全上限，仿真在 t=${t} 处停止，尾部尚未计算`;
      return null;
    }

    // 1) 落齐该时刻外部激励（输入是理想源，立即改变物理态）。
    if (this.stimulusAt.has(t)) {
      for (const [id, value] of this.stimulusAt.get(t)!)
        this.current.set(id, value);
      this.stimulusCursor++;
    }

    // 2) 落齐该时刻到点事件；惯性模型丢弃与当前物理态相同的事件，
    //    这正是短脉冲被滤波、且不影响后续合法边沿的机制。
    const bucket = this.buckets.get(t);
    if (bucket) {
      this.buckets.delete(t);
      const at = this.timeIndex.indexOf(t);
      if (at >= 0) this.timeIndex.splice(at, 1);
      for (const [id, value] of bucket) {
        const list = this.scheduled.get(id);
        if (list && list[0]?.time === t) list.shift();
        if (this.model === "inertial" && this.current.get(id) === value)
          continue;
        this.current.set(id, value);
      }
    }

    // 3a) 先让零延迟元件（OUTPUT 导线、零延迟门）收敛到固定点，使本时刻
    //     所有物理输入稳定下来；无环电路的遍历次数有界。
    let guard = 0;
    let pendingPhysical = true;
    while (pendingPhysical) {
      if (++guard > this.order.length * 2 + 4) {
        this.truncated = `t=${t} 处出现无法收敛的零延迟回路，仿真停止`;
        return null;
      }
      pendingPhysical = false;
      for (const id of this.order) {
        const node = this.nodes.get(id)!;
        if (node.kind === "INPUT") continue;
        const ideal = this.idealOf(node);
        if (ideal !== 0 && ideal !== 1) continue;
        if (edgeDelay(node, ideal) > 0) continue; // 有延迟的门留到 3b
        if (this.current.get(id) === ideal) continue;
        this.current.set(id, ideal);
        const list = this.scheduled.get(id);
        if (list && list[0]?.time === t) list.shift();
        pendingPhysical = true;
      }
    }

    // 3b) 输入已全部稳定，再对有延迟的门做一遍对账并排程。这样同一时刻
    //     到齐的多路变化只会产生一次、且确定的理想输出评估，与元件顺序无关。
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (!isGate(node)) continue;
      const ideal = this.idealOf(node);
      if (ideal !== 0 && ideal !== 1) continue;
      if (edgeDelay(node, ideal) === 0) {
        if (this.current.get(id) !== ideal) this.current.set(id, ideal);
        continue;
      }
      this.reconcile(node, ideal);
    }

    // 4) 记录该时刻真正发生的物理变化，波形只反映已传播到的值。
    const changed: string[] = [];
    for (const id of this.order) {
      const value = this.current.get(id) ?? "X";
      const trace = this.traces[id];
      const last = trace[trace.length - 1];
      if (last.value !== value) {
        trace.push({ time: t, value });
        changed.push(id);
      }
    }
    if (changed.length) this.stepTimes.push(t);
    return changed;
  }

  result(): ScopeRunResult {
    return {
      traces: this.traces,
      stepTimes: [...this.stepTimes],
      advanceTimes: [...this.advanceTimes],
      stimulusTimes: [...this.stimulusTimes],
      computedUntil: this.now,
      complete: !this.hasWork && !this.truncated,
      truncated: this.truncated,
    };
  }
}

/** 一次性跑完（或跑到安全上限）的便捷封装。 */
export function runSimulation(
  document: CircuitDocument,
  stimulus: StimulusVector[],
  model: DelayModel,
  maxEvents = DEFAULT_MAX_EVENTS,
): ScopeRunResult {
  const engine = new TimingEngine(document, stimulus, model, maxEvents);
  while (engine.hasWork && !engine.truncated) engine.advance();
  return engine.result();
}

/** 查询某节点在给定时刻已经传播到位的取值；晚于计算上界返回 X。 */
export function valueAt(
  trace: TracePoint[] | undefined,
  time: number,
  computedUntil: number,
): Signal {
  if (!trace || !trace.length || time > computedUntil) return "X";
  let value: Signal = trace[0].value;
  for (const point of trace) {
    if (point.time <= time) value = point.value;
    else break;
  }
  return value;
}
