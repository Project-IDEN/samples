"use client";

import { useState } from "react";
import { shrink } from "@/lib/camera";
import { call, cosine, frameForm, type EmbedResult } from "@/lib/engine";

interface Photo {
  name: string;
  url: string;
  embedding: number[] | null;
}

/**
 * Recognition alone: photos through `/embed`, compared pairwise here. No
 * liveness — `/embed` is the engine's re-embedding call for stored photos.
 */
export function PhotoCompare({ threshold }: { threshold: number | null }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const list = [...files].slice(0, 16);
      const blobs = await Promise.all(list.map((file) => shrink(file)));
      const { embeddings } = await call<EmbedResult>("embed", frameForm(blobs));
      setPhotos((all) => [
        ...all,
        ...list.map((file, i) => ({
          name: file.name,
          url: URL.createObjectURL(blobs[i]),
          embedding: embeddings[i],
        })),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
  }

  return (
    <div className="photos">
      <div className="row">
        <label className="file">
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            disabled={busy}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="primary">{busy ? "Embedding…" : "Add photos"}</span>
        </label>
        {photos.length ? (
          <button type="button" className="ghost" onClick={clear}>
            Clear
          </button>
        ) : null}
        <p className="hint">
          Each photo is embedded on its own; every pair is compared by cosine similarity. A pair at
          or above the threshold{threshold !== null ? ` (${threshold.toFixed(3)})` : ""} counts as
          the same person.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {photos.length ? (
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th />
                {photos.map((p) => (
                  <th key={p.url} scope="col">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local blob */}
                    <img src={p.url} alt={p.name} title={p.name} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {photos.map((row, r) => (
                <tr key={row.url}>
                  <th scope="row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local blob */}
                    <img src={row.url} alt={row.name} title={row.name} />
                  </th>
                  {photos.map((col, c) => {
                    if (!row.embedding || !col.embedding)
                      return (
                        <td key={col.url} className="none" title="No single face found">
                          —
                        </td>
                      );
                    const score = cosine(row.embedding, col.embedding);
                    const same = threshold !== null && score >= threshold;
                    return (
                      <td key={col.url} className={r === c ? "self" : same ? "same" : "other"}>
                        {score.toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
