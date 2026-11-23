import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

// 仅精确匹配功能模块的目录形式导入（"@/features/xxx"），子路径如
// "@/features/scope/lib/engine" 不命中这些规则，继续落到最后的 "@" 别名。
const feature = (name: string) => ({
  find: new RegExp(`^@/features/${name}$`),
  replacement: `${src}/features/${name}/index.ts`,
});

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // 显式列出各功能模块的 index 入口，避免在非 ASCII 工作目录下
    // Vite 无法解析目录形式的 "@/features/xxx" 导入。fileURLToPath 会
    // 正确解码路径，避免构建期绝对路径被 URL 百分号编码。
    alias: [
      feature("catalog"),
      feature("circuit"),
      feature("simulation"),
      feature("challenge"),
      feature("workspace"),
      feature("scope"),
      { find: "@", replacement: src },
    ],
  },
});
