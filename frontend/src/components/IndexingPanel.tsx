import { useState, useEffect, useRef } from "react";
import { startIndexing, getIndexStatus } from "../api/client";
import type { IndexStatus } from "../types";

interface Props {
  onClose: () => void;
  onDone: () => void;
}

// Common photo directories to suggest
const QUICK_PATHS = [
  // Windows
  { label: "Pictures (Windows)", path: "C:\\Users\\%USERNAME%\\Pictures" },
  { label: "OneDrive Pictures", path: "C:\\Users\\%USERNAME%\\OneDrive\\Pictures" },
  // macOS
  { label: "Pictures (macOS)", path: "~/Pictures" },
  {
    label: "Apple Photos Library (macOS)",
    path: "~/Pictures/Photos Library.photoslibrary/originals",
    note: "Browse your iPhone & iCloud photos directly from the Photos Library",
  },
  { label: "iCloud Drive Photos", path: "~/Library/Mobile Documents/com~apple~CloudDocs/Pictures" },
  // Linux
  { label: "Pictures (Linux)", path: "~/Pictures" },
];

export default function IndexingPanel({ onClose, onDone }: Props) {
  const [directory, setDirectory] = useState("");
  const [forceReindex, setForceReindex] = useState(false);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll status if indexing is running
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await getIndexStatus();
        setStatus(s);
        if (!s.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s.finished_at) onDone();
        }
      } catch {}
    };

    poll(); // Check immediately
    pollRef.current = setInterval(poll, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    setError("");
    try {
      await startIndexing(directory.trim(), forceReindex);
      const s = await getIndexStatus();
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start indexing");
    }
  };

  const isRunning = status?.running ?? false;
  const progress = status && status.total > 0
    ? Math.round((status.processed / status.total) * 100)
    : 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget && !isRunning) onClose(); }}
    >
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 24, width: 520, maxWidth: "95vw",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Index Photos</div>
          {!isRunning && (
            <button onClick={onClose} style={{ color: "var(--text2)", fontSize: 18, lineHeight: 1 }}>✕</button>
          )}
        </div>

        {!isRunning ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text2)", marginBottom: 6 }}>
                Directory path
              </label>
              <input
                value={directory}
                onChange={e => setDirectory(e.target.value)}
                placeholder="e.g. C:\Users\You\Pictures  or  ~/Pictures"
                style={{ width: "100%", padding: "8px 12px" }}
                onKeyDown={e => { if (e.key === "Enter" && directory.trim()) handleStart(); }}
              />
            </div>

            {/* Quick path suggestions */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>Quick paths:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {QUICK_PATHS.map(p => (
                  <button
                    key={p.path}
                    onClick={() => setDirectory(p.path)}
                    style={{
                      textAlign: "left", padding: "6px 10px",
                      background: directory === p.path ? "var(--bg3)" : "transparent",
                      border: "1px solid var(--border)", borderRadius: 6,
                      fontSize: 12,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = directory === p.path ? "var(--bg3)" : "transparent";
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{p.label}</div>
                    <div style={{ color: "var(--text2)", fontFamily: "monospace", fontSize: 11 }}>{p.path}</div>
                    {p.note && (
                      <div style={{ color: "#22C55E", fontSize: 10, marginTop: 2 }}>{p.note}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={forceReindex}
                onChange={e => setForceReindex(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              Force re-index already indexed photos
            </label>

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 12px", marginBottom: 16, fontSize: 13, color: "#FCA5A5" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleStart}
              disabled={!directory.trim()}
              style={{
                width: "100%", background: "var(--accent)", color: "#fff",
                padding: "10px 0", borderRadius: 8, fontWeight: 600, fontSize: 14,
                opacity: directory.trim() ? 1 : 0.4,
              }}
            >
              Start Indexing
            </button>
          </>
        ) : (
          /* Progress view */
          <div>
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text2)" }}>
              Scanning: <span style={{ color: "var(--text)" }}>{status?.directory}</span>
            </div>

            {/* Progress bar */}
            <div style={{ background: "var(--bg3)", borderRadius: 8, overflow: "hidden", marginBottom: 10, height: 10 }}>
              <div style={{
                height: "100%", background: "var(--accent)",
                width: `${progress}%`, transition: "width 0.3s",
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 16 }}>
              <span style={{ color: "var(--text2)" }}>
                {status?.processed.toLocaleString()} / {status?.total.toLocaleString()} photos
              </span>
              <span style={{ fontWeight: 600 }}>{progress}%</span>
            </div>

            <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
              <Stat label="Processed" value={status?.processed ?? 0} />
              <Stat label="Skipped" value={status?.skipped ?? 0} color="var(--text2)" />
              <Stat label="Errors" value={status?.errors ?? 0} color={status?.errors ? "var(--danger)" : undefined} />
            </div>

            {status?.current_file && (
              <div style={{
                fontSize: 11, color: "var(--text2)", fontFamily: "monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {status.current_file}
              </div>
            )}

            <div style={{ marginTop: 16, fontSize: 12, color: "var(--text2)", textAlign: "center" }}>
              Indexing in progress — you can browse existing photos while this runs.
              <br />
              <button onClick={onClose} style={{ color: "var(--accent)", marginTop: 6 }}>
                Dismiss (indexing continues in background)
              </button>
            </div>
          </div>
        )}

        {/* Last run summary */}
        {!isRunning && status?.finished_at && (
          <div style={{
            marginTop: 16, padding: "10px 14px",
            background: "var(--bg3)", borderRadius: 8, fontSize: 12,
          }}>
            <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>
              Last index complete
            </div>
            <div style={{ color: "var(--text2)" }}>
              {status.processed.toLocaleString()} processed · {status.skipped.toLocaleString()} skipped · {status.errors} errors
            </div>
            {status.finished_at && (
              <div style={{ color: "var(--text2)", marginTop: 2 }}>
                Finished: {new Date(status.finished_at).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "var(--text2)" }}>{label}</div>
    </div>
  );
}
