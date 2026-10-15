"use client";

import { useEffect, useState } from "react";
import { EngineInfo } from "@/components/engine-info";
import { LiveCapture } from "@/components/live-capture";
import { People, type Person } from "@/components/people";
import { PhotoCompare } from "@/components/photo-compare";
import type { EnrollResult, Info } from "@/lib/engine";

const STORAGE_KEY = "engine-lab:people";

function load(): Person[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(people: Person[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  } catch {
    // Private window or storage full: enrolments last until the page closes.
  }
}

export function Lab() {
  const [tab, setTab] = useState<"live" | "photos">("live");
  const [info, setInfo] = useState<Info | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only in the browser
  useEffect(() => setPeople(load()), []);

  function update(next: Person[]) {
    setPeople(next);
    save(next);
  }

  function enrolled(name: string, result: EnrollResult) {
    update([
      ...people.filter((p) => p.name !== name),
      { name, templates: result.embeddings, modelVersion: result.model_version },
    ]);
  }

  return (
    <main>
      <header className="top">
        <div>
          <h1>
            <span className="mark">IDEN</span> Engine Lab
          </h1>
          <p>Try the IDEN biometric engine directly: capture, liveness, and matching.</p>
        </div>
        <EngineInfo onInfo={setInfo} />
      </header>

      <nav className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          className={tab === "live" ? "on" : ""}
          onClick={() => setTab("live")}
        >
          Live capture
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "photos"}
          className={tab === "photos" ? "on" : ""}
          onClick={() => setTab("photos")}
        >
          Compare photos
        </button>
      </nav>

      {tab === "live" ? (
        <>
          <LiveCapture people={people} onEnrolled={enrolled} />
          <People
            people={people}
            modelVersion={info?.model_version ?? null}
            onRemove={(name) => update(people.filter((p) => p.name !== name))}
          />
        </>
      ) : (
        <PhotoCompare threshold={info?.match_threshold ?? null} />
      )}
    </main>
  );
}
