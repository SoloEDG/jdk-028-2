<script setup lang="ts">
import { computed } from "vue";
import type { CircuitDocument, GateNode } from "@/shared/types";
import { DEFAULT_GATE_DELAY, edgeDelay } from "../lib/engine";

const props = defineProps<{
  document: CircuitDocument;
  selectedId: string | null;
  timeUnit: string;
}>();
const emit = defineEmits<{
  delay: [id: string, edge: "riseDelay" | "fallDelay", value: number];
}>();

const gates = computed(() =>
  props.document.nodes.filter(
    (n) => n.kind !== "INPUT" && n.kind !== "OUTPUT",
  ),
);
const selected = computed(() =>
  props.document.nodes.find((n) => n.id === props.selectedId) ?? null,
);

function commit(node: GateNode, edge: "riseDelay" | "fallDelay", raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return;
  emit("delay", node.id, edge, value);
}
</script>

<template>
  <div class="delay-editor">
    <div class="panel-heading">
      <span>门延迟</span><small>RISE / FALL · {{ timeUnit }}</small>
    </div>
    <p class="editor-hint">
      输入与输出元件为理想导线（0 延迟）；门缺省延迟
      {{ DEFAULT_GATE_DELAY }} {{ timeUnit }}，可分别设置上升、下降延迟。
    </p>
    <div v-if="selected && selected.kind !== 'INPUT' && selected.kind !== 'OUTPUT'" class="selected-delay">
      <b>{{ selected.label }}</b>
      <label
        >上升
        <input
          type="number"
          min="0"
          step="1"
          :value="edgeDelay(selected, 1)"
          @change="commit(selected, 'riseDelay', ($event.target as HTMLInputElement).value)"
      /></label>
      <label
        >下降
        <input
          type="number"
          min="0"
          step="1"
          :value="edgeDelay(selected, 0)"
          @change="commit(selected, 'fallDelay', ($event.target as HTMLInputElement).value)"
      /></label>
    </div>
    <div v-else class="delay-table-wrap">
      <table class="delay-table">
        <thead>
          <tr><th>元件</th><th>上升</th><th>下降</th></tr>
        </thead>
        <tbody>
          <tr v-for="node in gates" :key="node.id">
            <td>{{ node.label }}</td>
            <td>{{ edgeDelay(node, 1) }}</td>
            <td>{{ edgeDelay(node, 0) }}</td>
          </tr>
          <tr v-if="!gates.length">
            <td colspan="3" class="empty-row">还没有门元件</td>
          </tr>
        </tbody>
      </table>
      <p class="editor-hint">点选工作台上的门可直接修改其延迟。</p>
    </div>
  </div>
</template>
