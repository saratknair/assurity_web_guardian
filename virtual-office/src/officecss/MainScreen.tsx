import type { RunFindings } from "../office/findingsData";

interface Props {
  runId: string | null;
  phase: string;
  idle: boolean;
  findings: RunFindings;
}

/**
 * The back-wall "video wall": a digital twin of the site under inspection.
 * Shows the latest page screenshot the run captured (if any), overlaid with
 * the live run status (run id, phase, issues contained). Purely data-driven;
 * when no screenshot is available it shows a stylised scan grid instead.
 */
export function MainScreen({ runId, phase, idle, findings }: Props) {
  // Pick a representative screenshot: the first page's desktop shot if present.
  const firstShot = findings.pages[0]?.shots.find((s) => s.label === "Desktop");
  const issues = findings.specimens.length;

  return (
    <div className="mainscreen">
      <div className="mainscreen__bezel">
        <div className="mainscreen__feed">
          {firstShot ? (
            <img
              className="mainscreen__shot"
              src={firstShot.url}
              alt="Site under inspection"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : null}
          <div className="mainscreen__grid" />
          <div className="mainscreen__scan" />
        </div>
        <div className="mainscreen__hud">
          <div className="mainscreen__row">
            <span className="mainscreen__k">TARGET</span>
            <span className="mainscreen__v">assurity.nz</span>
          </div>
          <div className="mainscreen__row">
            <span className="mainscreen__k">RUN</span>
            <span className="mainscreen__v">{runId ?? "-"}</span>
          </div>
          <div className="mainscreen__row">
            <span className="mainscreen__k">PHASE</span>
            <span className={"mainscreen__v " + (idle ? "is-idle" : "is-live")}>{idle ? "idle" : phase}</span>
          </div>
          <div className="mainscreen__row">
            <span className="mainscreen__k">CONTAINED</span>
            <span className="mainscreen__v mainscreen__v--warn">{issues} finding(s)</span>
          </div>
        </div>
      </div>
      <div className="mainscreen__title">ASSURITY WEB GUARDIAN</div>
    </div>
  );
}