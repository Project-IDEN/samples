"use client";

export interface Person {
  name: string;
  templates: number[][];
  modelVersion: string;
}

export function People({
  people,
  modelVersion,
  onRemove,
}: {
  people: Person[];
  modelVersion: string | null;
  onRemove: (name: string) => void;
}) {
  if (!people.length) return null;
  return (
    <section className="people">
      <h2>Enrolled in this browser</h2>
      <ul>
        {people.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong>
            <span className="metric">{p.templates.length} templates</span>
            {modelVersion && p.modelVersion !== modelVersion ? (
              <span className="tag warn" title={`Enrolled under ${p.modelVersion}`}>
                other model
              </span>
            ) : null}
            <button type="button" className="ghost" onClick={() => onRemove(p.name)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
