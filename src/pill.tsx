import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./pill.css";

// No native context menus (see main.tsx).
window.addEventListener("contextmenu", (e) => e.preventDefault());

type PillState = "idle" | "recording" | "processing" | "handsfree";

function PillApp() {
  const hudRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PillState>("idle");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<PillState>("idle");
  const [toast, setToast] = useState<{ message: string; status?: string } | null>(null);
  const [appIcon, setAppIcon] = useState<{ icon: string; label: string } | null>(null);

  const setPillState = (s: PillState) => {
    if (s === "idle") {
      setAppIcon(null);
    }
    if (stateRef.current === s) return;
    stateRef.current = s;
    setState(s);
    getCurrentWindow().setIgnoreCursorEvents(s !== "handsfree").catch(() => {});
    if (!hudRef.current) return;
    hudRef.current.classList.remove("hud--idle", "hud--recording", "hud--processing", "hud--handsfree");
    hudRef.current.classList.add(`hud--${s}`);
    if (s === "idle") {
      hudRef.current.classList.remove("hud--has-icon");
    }
  };

  useEffect(() => {
    setPillState("idle");
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {});
  }, []);

  useEffect(() => {
    let u: (() => void) | undefined;
    listen<{ message: string; status?: string }>("show-toast", (e) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(e.payload);
      toastTimer.current = setTimeout(() => setToast(null), e.payload.status === "error" ? 3200 : 2400);
    }).then((fn) => (u = fn)).catch(() => {});
    return () => {
      u?.();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    listen<{ state: PillState }>("pill-state", (e) => {
      const s = (e.payload.state as PillState) || "idle";
      if (s === "recording" || s === "processing" || s === "idle" || s === "handsfree") {
        setPillState(s);
      }
    }).then((u) => (u1 = u)).catch(() => {});

    listen<{ appId: string | null; icon?: string | null; label?: string | null }>("pill-context", (e) => {
      if (e.payload.appId && e.payload.icon) {
        setAppIcon({ icon: e.payload.icon, label: e.payload.label ?? e.payload.appId });
      } else {
        setAppIcon(null);
      }
    }).then((u) => (u2 = u)).catch(() => {});

    return () => {
      u1?.();
      u2?.();
    };
  }, []);

  const onCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPillState("idle");
    await emit("pill-cancel", {}).catch(() => {});
  };

  const onConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPillState("processing");
    await emit("pill-confirm", {}).catch(() => {});
  };

  // Wispr Flow-style vertical sound-reactive bouncing equalizer bars
  // Uses frame-rate-independent exponential smoothing for buttery motion
  useEffect(() => {
    const CSS_W = 46;
    const CSS_H = 16;

    function ensureBackingStore(c: HTMLCanvasElement): number {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(CSS_W * dpr));
      const h = Math.max(1, Math.round(CSS_H * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      return dpr;
    }

    const count = 10;
    const barWidth = 2.0;
    const totalBarWidth = count * barWidth;
    const spacing = (CSS_W - totalBarWidth) / (count - 1);
    const centerY = CSS_H / 2;
    const restH = 2.5;        // resting dot height
    const maxBarH = CSS_H - 1; // max bar height

    // Symmetrical center-weighted bell curve
    const weights = [0.30, 0.46, 0.64, 0.82, 1.0, 1.0, 0.82, 0.64, 0.46, 0.30];
    const currentBars = new Float32Array(count).fill(restH);

    // Per-bar unique frequency and phase offsets for organic independent motion
    const freqs = [2.8, 3.7, 4.9, 3.4, 5.5, 5.2, 3.9, 4.6, 3.3, 2.6];
    const phases = [0.0, 1.9, 0.7, 2.8, 1.3, 3.6, 0.4, 2.1, 3.1, 1.1];

    // Smoothing time constant in ms — frame-rate independent
    const TAU = 45;

    let lastT = -1;

    function draw(c: HTMLCanvasElement, t: number, dtMs: number) {
      const dpr = ensureBackingStore(c);
      const ctx = c.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CSS_W, CSS_H);

      // Time in seconds for cleaner frequency math
      const ts = t / 1000;

      // Global voice energy envelope
      const breath =
        0.5 +
        0.28 * Math.sin(ts * 1.7) +
        0.22 * Math.sin(ts * 2.9 + 1.1);
      const energy = Math.max(0.15, Math.min(1.0, breath));

      // Frame-rate independent exponential decay factor
      const alpha = 1 - Math.exp(-dtMs / TAU);

      for (let i = 0; i < count; i++) {
        // Per-bar independent oscillation
        const osc = 0.5 + 0.5 * Math.sin(ts * freqs[i] + phases[i]);
        const targetH = restH + (maxBarH - restH) * weights[i] * energy * osc;

        currentBars[i] += (targetH - currentBars[i]) * alpha;

        const h = Math.max(restH, Math.min(maxBarH, currentBars[i]));
        const x = i * (barWidth + spacing);
        const y = centerY - h / 2;
        const radius = barWidth / 2;

        ctx.fillStyle = "#ffffff";

        ctx.beginPath();
        const anyCtx = ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
        if (typeof anyCtx.roundRect === "function") {
          anyCtx.roundRect(x, y, barWidth, h, radius);
        } else {
          ctx.moveTo(x + radius, y);
          ctx.arcTo(x + barWidth, y, x + barWidth, y + h, radius);
          ctx.arcTo(x + barWidth, y + h, x, y + h, radius);
          ctx.arcTo(x, y + h, x, y, radius);
          ctx.arcTo(x, y, x + barWidth, y, radius);
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    let raf = 0;
    const frame = (t: number) => {
      const s = stateRef.current;
      const c = waveRef.current;

      if (c && (s === "recording" || s === "handsfree")) {
        const dtMs = lastT < 0 ? 16 : Math.min(50, Math.max(1, t - lastT));
        draw(c, t, dtMs);
      }
      lastT = t;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasAppIcon = !!appIcon && state !== "idle";

  return (
    <>
      <main className="stage">
        <div
          ref={hudRef}
          className={`hud hud--${state} ${hasAppIcon ? "hud--has-icon" : ""}`}
          role="button"
          aria-label="Recording"
        >
          {/* Hands-free cancel button (X) — permanently in DOM for fluid CSS transition */}
          <button
            className="hfX"
            onClick={onCancel}
            aria-label="Cancel"
            tabIndex={state === "handsfree" ? 0 : -1}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3.2 3.2L8.8 8.8M8.8 3.2L3.2 8.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          {/* Center cluster: app icon, bouncing equalizer bars, and spinner */}
          <div className="hud-center">
            {hasAppIcon && (
              <span className="appIcon" title={appIcon?.label} aria-hidden="true">
                <img src={appIcon!.icon} alt="" draggable={false} />
              </span>
            )}

            {/* Visualizer canvas */}
            <div
              className="wave-wrap"
              style={{
                display: (state === "recording" || state === "handsfree") ? "flex" : "none",
              }}
            >
              <canvas ref={waveRef} />
            </div>

            {/* Processing spinner */}
            {state === "processing" && (
              <span className="spinner" aria-hidden="true" />
            )}
          </div>

          {/* Hands-free confirm button (✓) — permanently in DOM for fluid CSS transition */}
          <button
            className="hfCheck"
            onClick={onConfirm}
            aria-label="Confirm"
            tabIndex={state === "handsfree" ? 0 : -1}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.4 6.3L5.1 8.9L9.6 3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </main>
      {toast && <div className={`pillToast pillToast--${toast.status ?? "info"}`} role="status">{toast.message}</div>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<PillApp />);
