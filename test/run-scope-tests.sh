#!/usr/bin/env bash
# 示波器引擎与快照的单元测试入口。
# 项目源码使用 "@/" 路径别名，Node 测试运行器不识别，因此先用 esbuild
# 把每个 *.test.ts 打包到临时目录再交给 node --test 执行。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

shopt -s nullglob
files=("$ROOT"/src/features/scope/lib/*.test.ts)
if [ "${#files[@]}" -eq 0 ]; then
  echo "没有找到 *.test.ts 测试文件"
  exit 1
fi

bundled=()
for file in "${files[@]}"; do
  target="$OUT/$(basename "${file%.ts}").mjs"
  "$ROOT/node_modules/.bin/esbuild" "$file" \
    --bundle --platform=node --format=esm \
    --alias:@="$ROOT/src" --outfile="$target" >/dev/null
  bundled+=("$target")
done

node --test "${bundled[@]}"
