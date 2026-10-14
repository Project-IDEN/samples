"use client";

import { useEffect, useRef, useState } from "react";

export type CameraStatus = "starting" | "ready" | "denied" | "missing";

/** The camera, at 640×480 like the kiosk and the sign-in page capture. */
export function useCamera(deviceId: string | null) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
        },
        audio: false,
      })
      .then(async (opened) => {
        if (cancelled) return opened.getTracks().forEach((t) => t.stop());
        stream = opened;
        if (video.current) {
          video.current.srcObject = opened;
          await video.current.play().catch(() => undefined);
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
        setStatus("ready");
      })
      .catch((error: DOMException) =>
        setStatus(error.name === "NotAllowedError" ? "denied" : "missing"),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  return { video, status, devices };
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The current video frame as a JPEG, unmirrored: the engine sees what the camera sees. */
export function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not capture a frame."))),
      "image/jpeg",
      0.85,
    ),
  );
}

/** A photo scaled down to fit the engine's per-frame byte limit (400 kB). */
export async function shrink(file: File, longest = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not read ${file.name}.`))),
      "image/jpeg",
      0.85,
    ),
  );
}
