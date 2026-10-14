"use client";

import { useEffect, useState } from "react";
import { call, type Info } from "@/lib/engine";

export function EngineInfo({ onInfo }: { onInfo: (info: Info | null) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const fresh = await call<Info>("info");
      setInfo(fresh);
      onInfo(fresh);
    } catch (e) {
      setInfo(null);
      onInfo(null);
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first load
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="engine-info" aria-live="polite">
      <span className={`dot ${info ? "ok" : error ? "bad" : ""}`} aria-hidden />
      {info ? (
        <dl>
          <div>
            <dt>Model</dt>
            <dd>{info.model_version}</dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd>{info.device}</dd>
          </div>
          <div>
            <dt>Match threshold</dt>
            <dd>
              {info.match_threshold.toFixed(3)}{" "}
              <span className={info.calibrated ? "tag pass" : "tag warn"}>
                {info.calibrated ? "calibrated" : "not calibrated"}
              </span>
            </dd>
          </div>
        </dl>
      ) : (
        <p>{error ?? "Connecting to the engine…"}</p>
      )}
      <button type="button" className="ghost" onClick={refresh}>
        Refresh
      </button>
    </section>
  );
}
