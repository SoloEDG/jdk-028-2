<script setup lang="ts">
import { computed } from "vue";
import type {
  CircuitDocument,
  DelayModel,
  StimulusVector,
} from "@/shared/types";
import { TIME_UNITS } from "../lib/stimulus";
import { useScope } from "../model/useScope";
import type { Notice } from "@/shared/commands";
import WaveformView from "./WaveformView.vue";
import StimulusEditor from "./StimulusEditor.vue";
import DelayEditor from "./DelayEditor.vue";

const props = defineProps<{
  document: CircuitDocument;
  scope: ReturnType<typeof useScope>;
  selectedId: string | null;
}>();
const emit = defineEmits<{ notice: [notice: Notice] }>();

const {
  timeUnit,
  model,
  stimulus,
  run,
  currentVersion,
  circuitStale,
  stimulusStale,
  playing,
  finished,
} = props.scope;

const hasRun = computed(() => run.value !== null);
const boardDoc = computed(() => run.value?.snapshot.document ?? props.document);

function onApply(vectors: StimulusVector[]) {
  props.scope.setStimulus(vectors);
  emit("notice", { tone: "success", message: "激励已更新，重新运行即可看到新波形" });
}
function onError(message: string) {
  emit("notice", { tone: "error", message });
}
function onDelay(id: string, edge: "riseDelay" | "fallDelay", value: number) {
  const node = props.document.nodes.find((n) => n.id === id);
  if (node) node[edge] = value;
  emit("notice", {
    tone: "info",
    message: `已修改 ${node?.label ?? "元件"} 延迟，新运行将使用新电路版本`,
  });
}
function modelLabel(m: DelayModel): string {
  return m === "transport" ? "传输延迟" : "惯性延迟";
}
</script>

<template>
  <section class="scope-panel">
    <div class="scope-head">
      <div class="panel-heading">
        <span>时序示波器</span><small>OSCILLOSCOPE</small>
      </div>
      <div class="scope-controls">
        <label class="unit-select"
          >时间单位
          <select
            :value="timeUnit"
            @change="scope.setTimeUnit(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="u in TIME_UNITS" :key="u.id" :value="u.id">
              {{ u.label }} ({{ u.symbol }})
            </option>
          </select></label
        >
        <div class="model-switch" role="group" aria-label="延迟模型">
          <button
            :class="{ active: model === 'transport' }"
            @click="scope.switchModel('transport')"
          >
            传输延迟
          </button>
          <button
            :class="{ active: model === 'inertial' }"
            @click="scope.switchModel('inertial')"
          >
            惯性延迟
          </button>
        </div>
      </div>
    </div>

    <div class="version-strip" :class="{ stale: circuitStale }">
      <template v-if="hasRun">
        <span class="version-badge">
          波形绑定电路版本 <b>{{ currentVersion }}</b>
        </span>
        <span v-if="circuitStale" class="version-warn">
          工作台电路已改动：当前波形仍为旧版本，新运行将使用新电路
        </span>
        <span v-else class="version-ok">电路未变更，波形与工作台一致</span>
        <span v-if="stimulusStale" class="version-warn">激励已修改，重新运行后生效</span>
      </template>
      <span v-else class="version-ok">尚未运行；运行后将锁定当前电路版本</span>
    </div>

    <div class="scope-buttons">
      <button class="primary" @click="scope.startRun()">
        {{ hasRun ? "重新运行" : "运行" }}
      </button>
      <button :disabled="!hasRun || playing" @click="scope.step()">单步前进</button>
      <button :disabled="!hasRun || playing || finished" @click="scope.play()">
        连续运行
      </button>
      <button :disabled="!playing" @click="scope.pause()">暂停</button>
      <button :disabled="!hasRun" @click="scope.stop()">停止计算</button>
      <button :disabled="!hasRun" @click="scope.resetRun()">回到起点</button>
      <button class="export-button" :disabled="!hasRun" @click="scope.exportWaveform()">
        导出波形 ↓
      </button>
    </div>

    <div v-if="hasRun" class="wave-wrap">
      <WaveformView
        :nodes="boardDoc.nodes"
        :result="run!.result.value"
        :current-time="run!.currentTime.value"
        :time-unit="timeUnit"
      />
      <div class="run-meta">
        <span>模型：<b>{{ modelLabel(run!.model) }}</b></span>
        <span>当前时刻：<b>t = {{ run!.currentTime.value }} {{ timeUnit }}</b></span>
        <span>已计算到：<b>t = {{ run!.result.value.computedUntil }} {{ timeUnit }}</b></span>
        <span v-if="run!.result.value.complete" class="meta-ok">仿真已完成</span>
        <span v-else-if="run!.stopped.value" class="meta-warn">已手动停止（尾部未计算）</span>
        <span v-else class="meta-muted">计算中…</span>
      </div>
    </div>
    <div v-else class="scope-empty">
      编辑激励并点击“运行”，在此观察带时间刻度的波形与汇合毛刺。
    </div>

    <div class="scope-side">
      <StimulusEditor
        :document="document"
        :stimulus="stimulus"
        :time-unit="timeUnit"
        @apply="onApply"
        @error="onError"
      />
      <DelayEditor
        :document="document"
        :selected-id="selectedId"
        :time-unit="timeUnit"
        @delay="onDelay"
      />
    </div>
  </section>
</template>
