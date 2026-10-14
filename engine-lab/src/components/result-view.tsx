import type { Checks, EnrollResult, VerifyResult } from "@/lib/engine";

const CHECKS: { key: keyof Checks; label: string; score: (c: Checks) => string }[] = [
  {
    key: "anti_spoofing",
    label: "Anti-spoofing",
    score: (c) => `mean live ${c.anti_spoofing_score.toFixed(3)}`,
  },
  {
    key: "actions",
    label: "Head movements",
    score: (c) => `${c.actions_score.toFixed(2)}× of what counts`,
  },
  {
    key: "consistent",
    label: "Same person throughout",
    score: (c) => `least similar ${c.consistency_score.toFixed(3)}`,
  },
];

function Verdict({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`tag ${ok ? "pass" : "fail"}`}>{ok ? yes : no}</span>;
}

export function ResultView({ result }: { result: EnrollResult | VerifyResult }) {
  return (
    <div className="result">
      <div className="verdicts">
        <Verdict ok={result.usable} yes="Usable" no="Not usable" />
        {result.usable ? <Verdict ok={result.live} yes="Live" no="Not live" /> : null}
        {"matched" in result && result.usable ? (
          <>
            <Verdict ok={result.matched} yes="Matched" no="No match" />
            <span className="metric">similarity {result.similarity.toFixed(3)}</span>
          </>
        ) : null}
        {"embeddings" in result && result.embeddings.length ? (
          <span className="metric">{result.embeddings.length} templates</span>
        ) : null}
      </div>

      {result.reasons.length ? (
        <p className="reasons">
          {result.reasons.map((reason) => (
            <code key={reason}>{reason}</code>
          ))}
        </p>
      ) : null}

      {result.checks ? (
        <table>
          <tbody>
            {CHECKS.map(({ key, label, score }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>
                  <Verdict ok={Boolean(result.checks?.[key])} yes="pass" no="fail" />
                </td>
                <td className="metric">{score(result.checks as Checks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <details>
        <summary>Raw response</summary>
        <pre>
          {JSON.stringify(
            {
              ...result,
              embeddings:
                "embeddings" in result
                  ? `[${result.embeddings.length} × ${result.embeddings[0]?.length ?? 0}]`
                  : undefined,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
