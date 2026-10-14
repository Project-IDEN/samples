"use client";

import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Head pose in the browser, so the capture can wait for a movement instead of
 * guessing when it happens. The engine still judges every frame it is sent;
 * this only decides when to take them.
 *
 * Yaw and pitch are the engine's own proxies (`engine/src/engine/pose.py`),
 * computed from the same five points — eyes, nose tip, mouth corners — taken
 * from MediaPipe's face mesh, so "turned far enough" means the same here.
 */

export interface Pose {
  /** Nose offset from the eyes' midpoint over the eye distance; + is the person's left. */
  yaw: number;
  /** Where the nose sits between the eye line (0) and the mouth line (1). */
  pitch: number;
}

// Face-mesh indices of the five points, in the unmirrored picture: the
// person's right eye is on the left of the image.
const RIGHT_EYE_CORNERS = [33, 133];
const LEFT_EYE_CORNERS = [362, 263];
const NOSE_TIP = 1;
const MOUTH_CORNERS = [61, 291];

type Point = [number, number];

function at(points: NormalizedLandmark[], index: number, width: number, height: number): Point {
  return [points[index].x * width, points[index].y * height];
}

function mean(...points: Point[]): Point {
  return [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ];
}

export function poseOf(points: NormalizedLandmark[], width: number, height: number): Pose {
  const pick = (i: number) => at(points, i, width, height);
  const leftEye = mean(...RIGHT_EYE_CORNERS.map(pick));
  const rightEye = mean(...LEFT_EYE_CORNERS.map(pick));
  const nose = pick(NOSE_TIP);
  const mouth = mean(...MOUTH_CORNERS.map(pick));
  const eyes = mean(leftEye, rightEye);

  // Undo the head's tilt first, so a tilted head does not read as turned.
  const dx = rightEye[0] - leftEye[0];
  const dy = rightEye[1] - leftEye[1];
  const roll = Math.atan2(dy, dx);
  const rotate = ([x, y]: Point): Point => [
    x * Math.cos(-roll) - y * Math.sin(-roll),
    x * Math.sin(-roll) + y * Math.cos(-roll),
  ];
  const noseR = rotate([nose[0] - eyes[0], nose[1] - eyes[1]]);
  const mouthR = rotate([mouth[0] - eyes[0], mouth[1] - eyes[1]]);
  const eyeDistance = Math.hypot(dx, dy);
  return {
    yaw: eyeDistance ? noseR[0] / eyeDistance : 0,
    pitch: noseR[1] / Math.max(mouthR[1], 1e-6),
  };
}

export interface HeadTracker {
  /** The pose in the latest frame, or null while no face is in view. */
  readonly latest: () => Pose | null;
  stop: () => void;
}

let landmarker: Promise<FaceLandmarker> | null = null;

/** Loads once per page: the runtime and model are ~15 MB. The GPU when the
 * browser offers WebGL2, the CPU otherwise. */
function load(): Promise<FaceLandmarker> {
  landmarker ??= FilesetResolver.forVisionTasks("/tracker").then((files) => {
    const create = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/tracker/face_landmarker.task", delegate },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    return create("GPU").catch(() => create("CPU"));
  });
  landmarker.catch(() => {
    landmarker = null;
  });
  return landmarker;
}

/** Follows the face in `video` on every new frame until stopped. */
export async function track(
  video: HTMLVideoElement,
  onPose?: (pose: Pose | null) => void,
): Promise<HeadTracker> {
  const model = await load();
  let latest: Pose | null = null;
  let running = true;
  let lastTime = -1;

  const step = () => {
    if (!running) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const face = model.detectForVideo(video, now).faceLandmarks[0];
      latest = face ? poseOf(face, video.videoWidth, video.videoHeight) : null;
      onPose?.(latest);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  return {
    latest: () => latest,
    stop: () => {
      running = false;
    },
  };
}
