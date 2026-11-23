<script setup lang="ts">
import { ref, watch } from "vue";
import type { CircuitDocument, StimulusVector } from "@/shared/types";
import { parseStimulusText, stimulusToText } from "../lib/stimulus";

const props = defineProps<{
  document: CircuitDocument;
  stimulus: StimulusVector[];
  timeUnit: string;
}>();
const emit = defineEmits<{
  apply: [vectors: StimulusVector[]];
  error: [message: string];
}>();

const text = ref(stimulusToText(props.document, props.stimulus));
const dirty = ref(false);

watch(
  () => props.stimulus,
  (next) => {
    if (!dirty.value) text.value = stimulusToText(props.document, next);
  },
  { deep: true },
);
watch(
  () => props.document.nodes,
  () => {
    text.value = stimulusToText(props.document, props.stimulus);
    dirty.value = false;
  },
  { deep: true },
);

function onInput(event: Event) {
  text.value = (event.target as HTMLTextAreaElement).value;
  dirty.value = true;
}

function apply() {
  const { vectors, error } = parseStimulusText(props.document, text.value);
  if (error) {
    emit("error", error);
    return;
  }
  emit("apply", vectors);
  dirty.value = false;
}

const inputLabels = props.document.nodes
  .filter((n) => n.kind === "INPUT")
  .map((n) => n.label);
</script>

<template>
  <div class="stimulus-editor">
    <div class="panel-heading">
      <span>激励向量</span><small>STIMULUS / {{ timeUnit }}</small>
    </div>
    <p class="editor-hint">
      每行一条：<code>时间 标签=0 标签=1</code>，同一行录入同一时刻的多路变化；
      <code>#</code> 开头为注释。
    </p>
    <textarea
      :value="text"
      rows="6"
      spellcheck="false"
      aria-label="激励向量编辑区"
      @input="onInput"
    ></textarea>
    <div class="editor-footer">
      <span class="input-chips">
        输入：<b v-for="label in inputLabels" :key="label">{{ label }}</b>
      </span>
      <button class="primary" @click="apply">应用激励</button>
    </div>
  </div>
</template>
