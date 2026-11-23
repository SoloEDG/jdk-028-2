<script setup lang="ts">
import { computed } from "vue";
import type {
  GateNode,
  ScopeRunResult,
  Signal,
  TracePoint,
} from "@/shared/types";
import { valueAt } from "../lib/engine";

const props = defineProps<{
  nodes: GateNode[];
  result: ScopeRunResult;
  currentTime: number;
  timeUnit: string;
  height?: number;
}>();

const ROW_H = 34;
const LABEL_W = 92;
const PAD_R = 24;
const VIEW_W = 980;
const plotW = VIEW_W - LABEL_W - PAD_R;

/** 波形时间轴上界：取已计算上界与全部事件时间的最大值，至少留一点余量 */
const maxTime = computed(() => {
  const times: number[] = [props.result.computedUntil];
  for (const trace of Object.values(props.result.traces))
    for (const point of trace) times.push(point.time);
  for (const t of props.result.stimulusTimes) times.push(t);
  const top = Math.max(...times, 1);
  return top * 1.08;
});

const xOf = (time: number): number =>
  LABEL_W + (time / maxTime.value) * plotW;

/** 等距刻度（取整齐的步长） */
const ticks = computed(() => {
  const top = maxTime.value;
  const rough = top / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = candidates.find((s) => s >= rough) ?? candidates[candidates.length - 1];
  const list: number[] = [];
  for (let t = 0; t <= top; t += step) list.push(Number(t.toFixed(6)));
  return list;
});

const traceNodes = computed(() =>
  props.nodes.filter((n) => props.result.traces[n.id]),
);

/** 生成某条波形的阶梯路径与未计算区域 */
function wavePath(trace: TracePoint[]): string {
  const until = props.result.computedUntil;
  const baseY = ROW_H / 2;
  const highY = 8;
  const lowY = ROW_H - 8;
  const y = (v: Signal) => (v === 1 ? highY : v === 0 ? lowY : baseY);
  let d = "";
  let penX = xOf(0);
  let penY = y(trace[0]?.value ?? "X");
  d += `M ${penX} ${penY}`;
  for (let i = 0; i < trace.length; i++) {
    const point = trace[i];
    if (point.time > until) break;
    const x = xOf(point.time);
    const prevY = y(trace[i - 1]?.value ?? trace[0].value);
    d += ` L ${x} ${prevY} L ${x} ${y(point.value)}`;
    penX = x;
    penY = y(point.value);
  }
  // 已计算区域内保持最后电平到 computedUntil
  const endX = xOf(until);
  if (endX > penX) d += ` L ${endX} ${penY}`;
  return d;
}

const viewHeight = computed(
  () => (props.height ?? traceNodes.value.length * ROW_H + 44),
);

const cursorX = computed(() =>
  Math.min(xOf(props.currentTime), LABEL_W + plotW),
);

function valueNow(nodeId: string): Signal {
  return valueAt(
    props.result.traces[nodeId],
    props.currentTime,
    props.result.computedUntil,
  );
}
</script>

<template>
  <div class="waveform-view">
    <svg
      :viewBox="`0 0 ${VIEW_W} ${viewHeight}`"
      role="img"
      aria-label="时序波形图"
    >
      <!-- 时间刻度 -->
      <g class="time-axis">
        <line
          :x1="LABEL_W"
          :x2="LABEL_W + plotW"
          :y1="20"
          :y2="20"
          class="axis-line"
        />
        <g v-for="tick in ticks" :key="tick">
          <line
            :x1="xOf(tick)"
            :x2="xOf(tick)"
            :y1="16"
            :y2="22"
            class="axis-tick"
          />
          <text :x="xOf(tick)" y="12" class="axis-label" text-anchor="middle">{{
            tick
          }}</text>
        </g>
        <text :x="LABEL_W + plotW + 4" y="12" class="unit-label">{{
          timeUnit
        }}</text>
      </g>

      <!-- 未计算尾部阴影：computedUntil 之后不画成稳定值 -->
      <rect
        v-if="!result.complete"
        :x="xOf(result.computedUntil)"
        :y="24"
        :width="LABEL_W + plotW - xOf(result.computedUntil)"
        :height="viewHeight - 30"
        class="uncomputed-zone"
      />

      <!-- 每条信号一行 -->
      <g
        v-for="(node, row) in traceNodes"
        :key="node.id"
        :transform="`translate(0, ${24 + row * ROW_H})`"
      >
        <line
          :x1="LABEL_W"
          :x2="LABEL_W + plotW"
          :y1="ROW_H / 2"
          :y2="ROW_H / 2"
          class="row-baseline"
        />
        <text :x="8" :y="ROW_H / 2 + 4" class="row-label">{{
          node.label
        }}</text>
        <path
          :d="wavePath(result.traces[node.id])"
          class="wave-line"
          :class="`wave-${valueNow(node.id)}`"
          fill="none"
        />
      </g>

      <!-- 当前时刻游标 -->
      <line
        :x1="cursorX"
        :x2="cursorX"
        :y1="22"
        :y2="viewHeight - 6"
        class="cursor-line"
      />
      <text :x="cursorX" :y="viewHeight - 1" class="cursor-label" text-anchor="middle"
        >t={{ currentTime }}{{ timeUnit }}</text
      >
    </svg>
    <p v-if="!result.complete" class="tail-note">
      阴影区为尚未计算的尾部，停止计算后不会把它画成稳定电平。
    </p>
  </div>
</template>
