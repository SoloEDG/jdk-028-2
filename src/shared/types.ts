export type Signal = 0 | 1 | "X";
export type GateKind =
  "INPUT" | "OUTPUT" | "AND" | "OR" | "XOR" | "NOT" | "NAND" | "NOR";
export interface Point {
  x: number;
  y: number;
}
export interface GateNode extends Point {
  id: string;
  kind: GateKind;
  label: string;
  value: 0 | 1;
  /** 上升沿传输延迟（时间单位），输入/输出元件为理想导线（0） */
  riseDelay?: number;
  /** 下降沿传输延迟（时间单位），输入/输出元件为理想导线（0） */
  fallDelay?: number;
}
export interface Endpoint {
  nodeId: string;
  port: number;
}
export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
}
export interface CircuitDocument {
  version: 1;
  name: string;
  nodes: GateNode[];
  wires: Wire[];
  targetId: string;
}
export interface GateSpec {
  kind: GateKind;
  name: string;
  symbol: string;
  inputs: number;
  outputs: number;
  description: string;
}
export interface SimulationResult {
  values: Record<string, Signal>;
  pins: Record<string, Signal[]>;
  wires: Record<string, Signal>;
  order: string[];
}

/* ---------- 示波器（时序仿真） ---------- */
export type DelayModel = "transport" | "inertial";
/** 单个时间点上所有输入的取值；未列出的输入沿用上一时刻的值 */
export interface StimulusVector {
  time: number;
  values: Record<string, 0 | 1>;
}
/** 一条信号在单个时间点的取值记录 */
export interface TracePoint {
  time: number;
  value: Signal;
}
export interface ScopeRunResult {
  /** 每个节点按时间排序的取值变化记录（首项为 t=0 初值） */
  traces: Record<string, TracePoint[]>;
  /** 实际处理过的、含有信号变化的时间刻度（步进停靠点） */
  stepTimes: number[];
  /** 每一次推进所处理的时间刻度（含未引起变化的激励点） */
  advanceTimes: number[];
  /** 激励排定的全部时间点（含没有引起任何变化的点） */
  stimulusTimes: number[];
  /** 已经完成计算的时间上界；其后的尾部为未计算区域 */
  computedUntil: number;
  /** 仿真是否在队列清空后自然结束 */
  complete: boolean;
  /** 因安全上限被截断时的说明 */
  truncated: string | null;
}
