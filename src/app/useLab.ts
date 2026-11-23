import { ref, watch } from "vue";
import type { Notice } from "@/shared/commands";
import type { Point, StimulusVector } from "@/shared/types";
import { usePlacement } from "@/features/catalog";
import { useCircuit } from "@/features/circuit";
import { useSimulation } from "@/features/simulation";
import { useChallenge } from "@/features/challenge";
import { loadInitial, useWorkspace } from "@/features/workspace";
import { useScope } from "@/features/scope";
import { defaultStimulus } from "@/features/scope/lib/stimulus";

export function useLab() {
  const initial = loadInitial(),
    document = ref(initial.document);
  const notice = ref<Notice>({
    tone: initial.warning ? "error" : "info",
    message:
      initial.warning ??
      "示例已就绪。切换到示波器模式，可观察信号沿时间轴的传播与毛刺。",
  });
  const notify = (next: Notice) => {
    notice.value = next;
  };
  const placement = usePlacement();
  const circuit = useCircuit(document, notify);
  const simulation = useSimulation(document),
    challenge = useChallenge(document);
  const scope = useScope(document, notify);
  scope.setStimulus(defaultStimulus(document.value));

  // 电路结构变化（增删元件/连线）后，刷新一份覆盖现有输入的默认激励，
  // 已有的示波器运行仍绑定旧版本，可继续观察。
  watch(
    () => [document.value.nodes.length, document.value.wires.length],
    () => {
      if (!scope.stimulus.value.length)
        scope.setStimulus(defaultStimulus(document.value));
    },
  );

  const workspace = useWorkspace(document, notify, () => {
    circuit.resetSelection();
    challenge.reset();
    placement.tool.value = null;
    scope.setStimulus(defaultStimulus(document.value));
  });
  function place(point: Point) {
    if (!placement.tool.value) return;
    if (document.value.nodes.length >= 120) {
      notify({
        tone: "error",
        message: "最多支持 120 个元件，请先删除不用的元件",
      });
      return;
    }
    const node = placement.createNode(
      document.value,
      placement.tool.value,
      point,
    );
    document.value.nodes.push(node);
    circuit.selected.value = node.id;
    placement.tool.value = null;
    notify({
      tone: "success",
      message: `已放置 ${node.label}，点击端口开始连线`,
    });
  }
  function move(id: string, point: Point) {
    const node = document.value.nodes.find((n) => n.id === id);
    if (node) {
      node.x = point.x;
      node.y = point.y;
    }
  }
  function cancel() {
    circuit.pending.value = null;
    placement.tool.value = null;
    notify({ tone: "info", message: "已取消当前放置或连线" });
  }
  function renameNode(label: string) {
    const node = document.value.nodes.find(
      (n) => n.id === circuit.selected.value,
    );
    if (node) node.label = label.trim().slice(0, 40) || node.kind;
  }
  function setStimulus(vectors: StimulusVector[]) {
    scope.setStimulus(vectors);
  }
  return {
    document,
    notice,
    notify,
    placement,
    circuit,
    simulation,
    challenge,
    workspace,
    scope,
    place,
    move,
    cancel,
    renameNode,
    setStimulus,
  };
}
