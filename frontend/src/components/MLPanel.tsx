import { useState, useEffect, useRef } from "react";
import type { MLCapabilities, BatchAnalysisStatus } from "../types";
import {
  getMLCapabilities, downloadMLModels,
  startBatchAnalysis, getBatchAnalysisStatus, clusterFaces,
} from "../api/client";

interface Props {
  onClose: () => void;
  onDone: () => void;
}

type Tab = "capabilities" | "analyze";

export default function MLPanel({ onClose, onDone }: Props) {
  const [tab, setTab] = useState<Tab>("capabilities");
  const [caps, setCaps] = useState<MLCapabilities | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMessages, setDownloadMessages] = useState<string[]>([]);
  const [batchStatus, setBatchStatus] = useState<BatchAnalysisStatus | null>(null);
  const [runFaces, setRunFaces] = useState(true);
  const [runActivities, setRunActivities] = useState(true);
  const [onlyUnanalyzed, setOnlyUnanalyzed] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCaps = async () => {
    try { setCaps(await getMLCapabilities()); } catch {}
  };

  useEffect(() => {
    loadCaps();
  }, []);

  // Poll batch status
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await getBatchAnalysisStatus();
        setBatchStatus(s);
        if (!s.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s.finished_at) onDone();
        }
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadModels = async () => {
    setDownloading(true);
    setDownloadMessages(["Starting download…"]);
    try {
      const result = await downloadMLModels();
      setDownloadMessages(result.messages.length > 0 ? result.messages : ["Done!"]);
      await loadCaps();
    } catch (e: unknown) {
      setDownloadMessages([e instanceof Error ? e.message : "Download failed"]);
    }
    setDownloading(false);
  };

  const handleStartBatch = async () => {
    setError("");
    const device = caps?.recommended_device ?? "cpu";
    try {
      await startBatchAnalysis({ run_faces: runFaces, run_activities: runActivities, only_unanalyzed: onlyUnanalyzed, device });
      setTab("analyze");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
  };

  const handleRecluster = async () => {
    setError("");
    try {
      const r = await clusterFaces();
      alert(`Clustering complete: ${r.people_created} people, ${r.faces_assigned} faces assigned, ${r.noise} unmatched.`);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Clustering failed");
    }
  };

  const isRunning = batchStatus?.running ?? false;
  const progress = batchStatus && batchStatus.total > 0
    ? Math.round((batchStatus.processed / batchStatus.total) * 100)
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
        borderRadius: 12, width: 560, maxWidth: "95vw", maxHeight: "90vh",
        overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>🤖 ML Features</div>
          {!isRunning && (
            <button onClick={onClose} style={{ color: "var(--text2)", fontSize: 18 }}>✕</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", padding: "0 20px" }}>
          {(["capabilities", "analyze"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: "10px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t ? "var(--text)" : "var(--text2)",
                marginBottom: -1,
              }}>
              {t === "capabilities" ? "Setup" : "Analyze"}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {tab === "capabilities" ? (
            <CapabilitiesTab
              caps={caps}
              downloading={downloading}
              downloadMessages={downloadMessages}
              onDownload={handleDownloadModels}
              onRefresh={loadCaps}
            />
          ) : (
            <AnalyzeTab
              caps={caps}
              batchStatus={batchStatus}
              isRunning={isRunning}
              progress={progress}
              runFaces={runFaces}
              runActivities={runActivities}
              onlyUnanalyzed={onlyUnanalyzed}
              error={error}
              onToggleFaces={() => setRunFaces(v => !v)}
              onToggleActivities={() => setRunActivities(v => !v)}
              onToggleUnanalyzed={() => setOnlyUnanalyzed(v => !v)}
              onStart={handleStartBatch}
              onRecluster={handleRecluster}
              onDismiss={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CapabilitiesTab({ caps, downloading, downloadMessages, onDownload, onRefresh }: {
  caps: MLCapabilities | null;
  downloading: boolean;
  downloadMessages: string[];
  onDownload: () => void;
  onRefresh: () => void;
}) {
  if (!caps) return <div style={{ color: "var(--text2)", textAlign: "center", paddingTop: 20 }}>Loading…</div>;

  const modelsReady = Object.values(caps.face_models_downloaded).every(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* System info */}
      <Section title="System">
        <Row label="Platform">{caps.platform} ({caps.arch})</Row>
        <Row label="RAM">{caps.ram_gb} GB</Row>
        <Row label="CPUs">{caps.cpu_count}</Row>
        <Row label="Accelerator">
          {caps.has_mps ? "🟢 Apple Silicon MPS" :
           caps.has_cuda ? "🟢 CUDA GPU" :
           "CPU only"}
        </Row>
        {caps.has_mps && (
          <div style={{ fontSize: 12, color: "#22C55E", marginTop: 4 }}>
            M-series Mac detected — ML inference will use Metal acceleration.
          </div>
        )}
      </Section>

      {/* Dependencies */}
      <Section title="Python Dependencies">
        <DepRow label="mediapipe" ok={caps.mediapipe_available}
          install="pip install mediapipe" />
        <DepRow label="scikit-learn" ok={caps.sklearn_available}
          install="pip install scikit-learn" />
        <DepRow label="torch" ok={caps.torch_available}
          install="pip install torch" />
        <DepRow label="transformers" ok={caps.transformers_available}
          install="pip install transformers" />

        {(!caps.mediapipe_available || !caps.sklearn_available || !caps.transformers_available || !caps.torch_available) && (
          <div style={{
            marginTop: 10, padding: "10px 14px", background: "var(--bg3)",
            borderRadius: 6, fontSize: 12, fontFamily: "monospace",
          }}>
            <div style={{ color: "var(--text2)", marginBottom: 4 }}>Install all ML deps:</div>
            <div>pip install -r backend/requirements-ml.txt</div>
          </div>
        )}
      </Section>

      {/* Face models */}
      <Section title="Face Detection Models">
        {Object.entries(caps.face_models_downloaded).map(([key, ready]) => (
          <Row key={key} label={key}>
            <StatusDot ok={ready} />
            {ready ? "Downloaded" : "Not downloaded"}
          </Row>
        ))}

        {caps.mediapipe_available && !modelsReady && (
          <button
            onClick={onDownload}
            disabled={downloading}
            style={{
              marginTop: 10, width: "100%", background: "var(--accent)", color: "#fff",
              padding: "8px 0", borderRadius: 6, fontSize: 13, fontWeight: 600,
              opacity: downloading ? 0.6 : 1,
            }}
          >
            {downloading ? "Downloading…" : "Download Models (~13 MB)"}
          </button>
        )}

        {!caps.mediapipe_available && (
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
            Install mediapipe first, then download models.
          </div>
        )}

        {downloadMessages.length > 0 && (
          <div style={{
            marginTop: 8, padding: "8px 10px", background: "var(--bg3)",
            borderRadius: 6, fontSize: 12, fontFamily: "monospace",
          }}>
            {downloadMessages.map((m, i) => <div key={i}>{m}</div>)}
          </div>
        )}
      </Section>

      {/* Readiness summary */}
      <Section title="Feature Readiness">
        <Row label="Face detection + recognition">
          <StatusDot ok={caps.face_detection_ready} />
          {caps.face_detection_ready ? "Ready" : "Not ready"}
        </Row>
        <Row label="Activity detection (CLIP)">
          <StatusDot ok={caps.activity_detection_ready} />
          {caps.activity_detection_ready ? "Ready" : "Not ready"}
          {caps.transformers_available && caps.ram_gb < 4 && (
            <span style={{ color: "var(--danger)", fontSize: 11, marginLeft: 6 }}>(needs ≥4 GB RAM)</span>
          )}
        </Row>
        {caps.activity_detection_ready && (
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
            CLIP model (~340 MB) will download from HuggingFace on first use and is cached.
          </div>
        )}
      </Section>

      <button onClick={onRefresh} style={{ color: "var(--text2)", fontSize: 12 }}>
        ↺ Refresh
      </button>
    </div>
  );
}

function AnalyzeTab({ caps, batchStatus, isRunning, progress,
  runFaces, runActivities, onlyUnanalyzed, error,
  onToggleFaces, onToggleActivities, onToggleUnanalyzed,
  onStart, onRecluster, onDismiss }: {
  caps: MLCapabilities | null;
  batchStatus: BatchAnalysisStatus | null;
  isRunning: boolean;
  progress: number;
  runFaces: boolean;
  runActivities: boolean;
  onlyUnanalyzed: boolean;
  error: string;
  onToggleFaces: () => void;
  onToggleActivities: () => void;
  onToggleUnanalyzed: () => void;
  onStart: () => void;
  onRecluster: () => void;
  onDismiss: () => void;
}) {
  const faceReady = caps?.face_detection_ready ?? false;
  const activityReady = caps?.activity_detection_ready ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Options */}
      {!isRunning && (
        <>
          <Section title="What to detect">
            <CheckRow
              label="Faces & People"
              sub="Detect faces, generate embeddings, cluster into People albums"
              checked={runFaces}
              onChange={onToggleFaces}
              disabled={!faceReady}
              notReadyMsg={!faceReady ? "Set up in the Setup tab first" : undefined}
            />
            <CheckRow
              label="Activities & Scenes"
              sub="Tag photos with scenes (beach, hiking, wedding, etc.) via CLIP"
              checked={runActivities}
              onChange={onToggleActivities}
              disabled={!activityReady}
              notReadyMsg={!activityReady ? "Install torch + transformers first" : undefined}
            />
          </Section>

          <Section title="Scope">
            <CheckRow
              label="Only unanalyzed photos"
              sub="Skip photos that have already been processed"
              checked={onlyUnanalyzed}
              onChange={onToggleUnanalyzed}
            />
          </Section>

          {caps && (
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              Will use device: <strong style={{ color: "var(--text)" }}>{caps.recommended_device.toUpperCase()}</strong>
              {caps.has_mps && " (Apple Silicon Metal)"}
              {caps.has_cuda && " (CUDA GPU)"}
            </div>
          )}

          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)",
              borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#FCA5A5",
            }}>{error}</div>
          )}

          <button
            onClick={onStart}
            disabled={!runFaces && !runActivities}
            style={{
              background: "var(--accent)", color: "#fff", padding: "10px 0",
              borderRadius: 8, fontWeight: 600, fontSize: 14, width: "100%",
              opacity: (runFaces || runActivities) ? 1 : 0.4,
            }}
          >
            Start Analysis
          </button>

          {/* Re-cluster button */}
          {faceReady && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
                Re-run face clustering to regroup People after analyzing more photos:
              </div>
              <button
                onClick={onRecluster}
                style={{
                  width: "100%", padding: "8px 0", borderRadius: 6, fontSize: 13,
                  border: "1px solid var(--border)", color: "var(--text2)",
                }}
              >
                Re-cluster Faces
              </button>
            </div>
          )}
        </>
      )}

      {/* Progress */}
      {(isRunning || (batchStatus?.finished_at && !batchStatus.running)) && (
        <div>
          {isRunning && (
            <>
              <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                Task: <span style={{ color: "var(--text)" }}>{batchStatus?.task}</span>
              </div>
              <div style={{ background: "var(--bg3)", borderRadius: 8, height: 10, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ height: "100%", background: "var(--accent)", width: `${progress}%`, transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 12 }}>
                <span style={{ color: "var(--text2)" }}>
                  {batchStatus?.processed.toLocaleString()} / {batchStatus?.total.toLocaleString()}
                </span>
                <span style={{ fontWeight: 600 }}>{progress}%</span>
              </div>
              {batchStatus?.current && (
                <div style={{ fontSize: 11, color: "var(--text2)", fontFamily: "monospace", marginBottom: 12 }}>
                  {batchStatus.current}
                </div>
              )}
            </>
          )}

          {batchStatus?.finished_at && !batchStatus.running && (
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "12px 14px", fontSize: 13 }}>
              <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>Analysis complete</div>
              <div style={{ color: "var(--text2)" }}>
                {batchStatus.processed} processed · {batchStatus.errors} errors
              </div>
            </div>
          )}

          {isRunning && (
            <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--text2)" }}>
              Analysis continues in background.{" "}
              <button onClick={onDismiss} style={{ color: "var(--accent)" }}>Dismiss</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--text2)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{children}</span>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: ok ? "#22C55E" : "#555",
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

function DepRow({ label, ok, install }: { label: string; ok: boolean; install: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <StatusDot ok={ok} />
      <span style={{ flex: 1, color: ok ? "var(--text)" : "var(--text2)" }}>{label}</span>
      {!ok && (
        <code style={{
          fontSize: 10, background: "var(--bg3)", padding: "2px 6px",
          borderRadius: 3, color: "var(--text2)",
        }}>{install}</code>
      )}
    </div>
  );
}

function CheckRow({ label, sub, checked, onChange, disabled, notReadyMsg }: {
  label: string; sub: string; checked: boolean; onChange: () => void;
  disabled?: boolean; notReadyMsg?: string;
}) {
  return (
    <label style={{
      display: "flex", gap: 10, cursor: disabled ? "not-allowed" : "pointer",
      padding: "8px 10px", borderRadius: 6, background: "var(--bg3)",
      opacity: disabled ? 0.5 : 1,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange}
        disabled={disabled} style={{ accentColor: "var(--accent)", marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text2)" }}>{notReadyMsg ?? sub}</div>
      </div>
    </label>
  );
}
