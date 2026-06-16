#!/usr/bin/env bash
# Тянет рантайм MediaPipe и модели в public/vendor/mediapipe/.
# Эти файлы намеренно не хранятся в git (см. .gitignore) — они большие.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="public/vendor/mediapipe"
mkdir -p "$DEST"

MP="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
echo "→ рантайм tasks-vision"
curl -fsSL -o "$DEST/vision_bundle.mjs" "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs"
curl -fsSL -o "$DEST/vision_wasm_internal.js" "$MP/vision_wasm_internal.js"
curl -fsSL -o "$DEST/vision_wasm_internal.wasm" "$MP/vision_wasm_internal.wasm"

echo "→ модель кисти"
curl -fsSL -o "$DEST/hand_landmarker.task" \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

echo "→ модель позы (lite)"
curl -fsSL -o "$DEST/pose_landmarker_lite.task" \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"

echo "Готово:"
ls -la "$DEST"
