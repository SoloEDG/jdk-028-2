import { computed, onUnmounted, ref, shallowRef, type Ref } from "vue";
import type {
  CircuitDocument,
  DelayModel,
  ScopeRunResult,
  SimulationResult,
  StimulusVector,
} from "../../../shared/types";
import type { Notice } from "../../../shared/commands";
import { topologicalOrder } from "../../circuit";
import { getSpec } from "../../catalog";
import {
  TimingEngine,
  valueAt,
} from "../lib/engine";
import {
  documentFingerprint,
  encodeScopeExport,
  snapshotFor,
  type ScopeExportFile,
  type ScopeSnapshot,
  type SnapshotStore,
} from "../lib/snapshot";

const SCOPE_STORAGE_KEY = "logic-lab-jdk-028-scope-v1";
const PLAY_INTERVAL_MS = 480;

export interface ActiveRun {
  snapshot: ScopeSnapshot;
  model: DelayModel;
  stimulus: StimulusVector[];
  stimulusSignature: string;
  engine: TimingEngine;
  result: Ref<ScopeRunResult>;
  currentTime: Ref<number>;
  stepIndex: Ref<number>;
  playing: Ref<boolean>;
  stopped: Ref<boolean>;
  order: string[];
}

interface PersistedScopePrefs {
  timeUnit: string;
  model: DelayModel;
}

export function useScope(
  document: Ref<CircuitDocument>,
  notify: (notice: Notice) => void,
) {
  const prefs = loadPrefs();
  const timeUnit = ref<string>(prefs.timeUnit);
  const model = ref<DelayModel>(prefs.model);
  const stimulus = ref<StimulusVector[]>([]);
  const run = shallowRef<ActiveRun | null>(null);
  const store: SnapshotStore = { snapshots: [], nextVersion: 1 };
  let timer: number | null = null;

  const liveFingerprint = computed(() => documentFingerprint(document.value));
  const currentVersion = computed(() => run.value?.snapshot.versionId ?? null);
  /** 当前工作台电路相对运行版本是否已被编辑 */
  const circuitStale = computed(
    () => !!run.value && run.value.snapshot.fingerprint !== liveFingerprint.value,
  );
  const stimulusStale = computed(
    () =>
      !!run.value &&
      run.value.stimulusSignature !== JSON.stringify(stimulus.value),
  );
  const playing = computed(() => run.value?.playing.value ?? false);
  const finished = computed(
    () => !!run.value && run.value.result.value.complete && !run.value.playing.value,
  );

  function loadPrefs(): PersistedScopePrefs {
    try {
      const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Partial<PersistedScopePrefs>;
        return {
          timeUnit: typeof data.timeUnit === "string" ? data.timeUnit : "ns",
          model: data.model === "inertial" ? "inertial" : "transport",
        };
      }
    } catch {
      /* 忽略损坏的本地设置 */
    }
    return { timeUnit: "ns", model: "transport" };
  }

  function persistPrefs() {
    try {
      localStorage.setItem(
        SCOPE_STORAGE_KEY,
        JSON.stringify({ timeUnit: timeUnit.value, model: model.value }),
      );
    } catch {
      /* 存储不可用时静默 */
    }
  }

  function clearTimer() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function pause() {
    clearTimer();
    if (run.value) run.value.playing.value = false;
  }

  function buildEngine(
    snapshot: ScopeSnapshot,
    vectors: StimulusVector[],
    delayModel: DelayModel,
  ): TimingEngine {
    return new TimingEngine(snapshot.document, vectors, delayModel);
  }

  /** 依据当前电路版本与激励创建一次新运行（t=0 初态） */
  function startRun(): boolean {
    pause();
    let order: string[];
    try {
      order = topologicalOrder(document.value);
    } catch (error) {
      notify({
        tone: "error",
        message: `无法启动时序仿真：${error instanceof Error ? error.message : "电路存在反馈环"}`,
      });
      return false;
    }
    const snapshot = snapshotFor(store, document.value);
    const vectors = stimulus.value;
    const engine = buildEngine(snapshot, vectors, model.value);
    const initial = engine.result();
    run.value = {
      snapshot,
      model: model.value,
      stimulus: JSON.parse(JSON.stringify(vectors)) as StimulusVector[],
      stimulusSignature: JSON.stringify(vectors),
      engine,
      result: ref(initial),
      currentTime: ref(0),
      stepIndex: ref(0),
      playing: ref(false),
      stopped: ref(false),
      order,
    };
    notify({
      tone: "success",
      message: `示波器已就绪，绑定电路版本 ${snapshot.versionId}（${model.value === "transport" ? "传输延迟" : "惯性延迟"}）`,
    });
    return true;
  }

  function syncResult(active: ActiveRun) {
    active.result.value = active.engine.result();
    active.currentTime.value = active.result.value.computedUntil;
    if (active.result.value.truncated) {
      pause();
      active.stopped.value = true;
      notify({ tone: "error", message: active.result.value.truncated });
    } else if (!active.engine.hasWork) {
      pause();
      notify({ tone: "info", message: "事件队列已清空，仿真自然结束" });
    }
  }

  /** 逐步前进：推进到下一个时间刻度并完成该时刻的全部传播 */
  function step() {
    const active = run.value;
    if (!active) {
      if (startRun()) step();
      return;
    }
    pause();
    if (!active.engine.hasWork || active.result.value.truncated) return;
    active.engine.advance();
    active.stepIndex.value += 1;
    syncResult(active);
  }

  /** 连续运行，直到队列清空或被停止 */
  function play() {
    const active = run.value;
    if (!active) {
      if (!startRun()) return;
    }
    const current = run.value!;
    if (!current.engine.hasWork || current.result.value.truncated) return;
    current.playing.value = true;
    clearTimer();
    timer = window.setInterval(() => {
      if (!current.engine.hasWork || current.result.value.truncated) {
        syncResult(current);
        return;
      }
      current.engine.advance();
      current.stepIndex.value += 1;
      syncResult(current);
    }, PLAY_INTERVAL_MS);
  }

  /** 停止计算：保留已算出的波形，未计算尾部保持空白而非稳定值 */
  function stop() {
    const active = run.value;
    if (!active) return;
    pause();
    active.stopped.value = true;
    notify({
      tone: "info",
      message: `已在 t=${active.currentTime.value} 处停止，其后的尾部尚未计算`,
    });
  }

  /** 回到 t=0 初态，保留同一电路版本与激励 */
  function resetRun() {
    const active = run.value;
    if (!active) return;
    pause();
    const rebuilt = buildEngine(active.snapshot, active.stimulus, active.model);
    active.engine = rebuilt;
    active.result.value = rebuilt.result();
    active.currentTime.value = 0;
    active.stepIndex.value = 0;
    active.stopped.value = false;
  }

  /** 切换延迟模型：同一激励、同一电路版本从头重新计算 */
  function switchModel(next: DelayModel) {
    if (next === model.value) return;
    model.value = next;
    persistPrefs();
    const active = run.value;
    if (!active) return;
    pause();
    active.model = next;
    const rebuilt = buildEngine(active.snapshot, active.stimulus, next);
    active.engine = rebuilt;
    active.result.value = rebuilt.result();
    active.currentTime.value = 0;
    active.stepIndex.value = 0;
    active.stopped.value = false;
    notify({
      tone: "info",
      message: `已切换为${next === "transport" ? "传输延迟" : "惯性延迟"}模型，并从同一激励重新计算`,
    });
  }

  function setTimeUnit(id: string) {
    timeUnit.value = id;
    persistPrefs();
  }

  function setStimulus(vectors: StimulusVector[]) {
    stimulus.value = vectors;
  }

  function discardRun() {
    pause();
    run.value = null;
  }

  /** 取运行版本在某时刻已传播到位的板级信号（供线路与元件着色） */
  function boardSignals(active: ActiveRun, time: number): SimulationResult {
    const doc = active.snapshot.document;
    const { traces, computedUntil } = active.result.value;
    const values: Record<string, SimulationResult["values"][string]> =
      Object.create(null);
    for (const node of doc.nodes)
      values[node.id] = valueAt(traces[node.id], time, computedUntil);
    const pins: Record<string, SimulationResult["pins"][string]> =
      Object.create(null);
    for (const node of doc.nodes) {
      pins[node.id] = Array.from(
        { length: getSpec(node.kind).inputs },
        (_, port) => {
          const wire = doc.wires.find(
            (w) => w.to.nodeId === node.id && w.to.port === port,
          );
          return wire ? (values[wire.from.nodeId] ?? "X") : "X";
        },
      );
    }
    const wires: Record<string, SimulationResult["wires"][string]> =
      Object.create(null);
    for (const wire of doc.wires)
      wires[wire.id] = values[wire.from.nodeId] ?? "X";
    return { values, pins, wires, order: active.order };
  }

  /** 导出波形文件：保留激励、时间单位、延迟模型与电路版本 */
  function exportWaveform() {
    const active = run.value;
    if (!active) {
      notify({ tone: "error", message: "还没有可导出的示波器运行，请先运行仿真" });
      return;
    }
    const file: ScopeExportFile = {
      format: "logic-lab-scope",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      timeUnit: timeUnit.value,
      delayModel: active.model,
      stimulus: active.stimulus,
      circuit: {
        versionId: active.snapshot.versionId,
        name: active.snapshot.name,
        fingerprint: active.snapshot.fingerprint,
        document: active.snapshot.document,
      },
      result: active.result.value,
    };
    const url = URL.createObjectURL(
      new Blob([encodeScopeExport(file)], { type: "application/json" }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${active.snapshot.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "logic-lab"}-waveform-${active.snapshot.versionId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify({ tone: "success", message: "波形文件已导出（含激励、时间单位与延迟模型）" });
  }

  onUnmounted(clearTimer);

  return {
    timeUnit,
    model,
    stimulus,
    run,
    currentVersion,
    circuitStale,
    stimulusStale,
    playing,
    finished,
    snapshots: store.snapshots,
    startRun,
    step,
    play,
    pause,
    stop,
    resetRun,
    switchModel,
    setTimeUnit,
    setStimulus,
    discardRun,
    boardSignals,
    exportWaveform,
  };
}
