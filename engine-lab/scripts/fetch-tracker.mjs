// Puts the head tracker's files in public/tracker, served from the app itself
// rather than a CDN: MediaPipe's WASM runtime from node_modules, and the face
// landmarker model, checked against its sha256 before it is kept.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT = "public/tracker";
const WASM = "node_modules/@mediapipe/tasks-vision/wasm";
const MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  file: `${OUT}/face_landmarker.task`,
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

await mkdir(OUT, { recursive: true });
for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  await copyFile(`${WASM}/${name}`, `${OUT}/${name}`);
}

if (!existsSync(MODEL.file) || sha256(await readFile(MODEL.file)) !== MODEL.sha256) {
  const response = await fetch(MODEL.url);
  if (!response.ok) throw new Error(`${MODEL.url} answered ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== MODEL.sha256) throw new Error(`${MODEL.url} does not match its sha256`);
  await writeFile(MODEL.file, data);
  console.log(`fetched ${MODEL.file}`);
}
