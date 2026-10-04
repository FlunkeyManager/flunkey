import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

export const MIN_OVERLAY_W = 300;
export const MIN_OVERLAY_H = 260;
export const MAX_OVERLAY_W = 1200;
export const MAX_OVERLAY_H = 900;

export type ResizeAxis = "both" | "horizontal" | "vertical";

type WindowMetrics = {
  width: number;
  height: number;
  scale: number;
};

type ResizeSession = {
  pointerId: number;
  axis: ResizeAxis;
  startScreenX: number;
  startScreenY: number;
  startWidth: number;
  startHeight: number;
  scale: number;
  rafId: number;
  pendingWidth?: number;
  pendingHeight?: number;
};

function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(MAX_OVERLAY_W, Math.max(MIN_OVERLAY_W, width)),
    height: Math.min(MAX_OVERLAY_H, Math.max(MIN_OVERLAY_H, height)),
  };
}

export function useOverlayWindowResize(
  enabled: boolean,
  onResizeEnd?: () => void
) {
  const metricsRef = useRef<WindowMetrics>({ width: 420, height: 720, scale: 1 });
  const sessionRef = useRef<ResizeSession | null>(null);
  const isResizingRef = useRef(false);

  const syncMetrics = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const [size, scale] = await Promise.all([
        win.innerSize(),
        win.scaleFactor(),
      ]);
      metricsRef.current = {
        width: size.width / scale,
        height: size.height / scale,
        scale,
      };
    } catch {
      // Keep last known metrics.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    void syncMetrics();

    const win = getCurrentWindow();
    let cancelled = false;
    let unlistenResize: (() => void) | undefined;

    win
      .onResized(() => {
        if (isResizingRef.current) return;
        void syncMetrics();
      })
      .then((u) => {
        if (cancelled) u();
        else unlistenResize = u;
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlistenResize?.();
    };
  }, [enabled, syncMetrics]);

  const applySize = useCallback((width: number, height: number) => {
    const next = clampSize(width, height);
    metricsRef.current.width = next.width;
    metricsRef.current.height = next.height;
    void getCurrentWindow().setSize(
      new LogicalSize(next.width, next.height)
    );
  }, []);

  const endSession = useCallback(
    (target: HTMLElement, pointerId: number) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== pointerId) return;

      if (session.rafId) {
        cancelAnimationFrame(session.rafId);
      }

      if (session.pendingWidth !== undefined && session.pendingHeight !== undefined) {
        applySize(session.pendingWidth, session.pendingHeight);
      }

      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // Already released.
      }

      sessionRef.current = null;
      isResizingRef.current = false;
      document.body.classList.remove(
        "overlay-resizing",
        "overlay-resizing--both",
        "overlay-resizing--horizontal",
        "overlay-resizing--vertical"
      );
      onResizeEnd?.();
    },
    [applySize, onResizeEnd]
  );

  const onResizePointerDown = useCallback(
    (axis: ResizeAxis) => (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget;
      const metrics = metricsRef.current;

      const session: ResizeSession = {
        pointerId: e.pointerId,
        axis,
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        startWidth: metrics.width,
        startHeight: metrics.height,
        scale: metrics.scale,
        rafId: 0,
      };

      sessionRef.current = session;
      isResizingRef.current = true;
      document.body.classList.add("overlay-resizing", `overlay-resizing--${axis}`);

      target.setPointerCapture(e.pointerId);

      const flush = () => {
        const active = sessionRef.current;
        if (!active) return;
        active.rafId = 0;

        if (
          active.pendingWidth === undefined ||
          active.pendingHeight === undefined
        ) {
          return;
        }

        applySize(active.pendingWidth, active.pendingHeight);
        active.pendingWidth = undefined;
        active.pendingHeight = undefined;
      };

      const onPointerMove = (ev: PointerEvent) => {
        const active = sessionRef.current;
        if (!active || ev.pointerId !== active.pointerId) return;

        const dw = (ev.screenX - active.startScreenX) / active.scale;
        const dh = (ev.screenY - active.startScreenY) / active.scale;

        let width = active.startWidth;
        let height = active.startHeight;

        if (active.axis === "both" || active.axis === "horizontal") {
          width = active.startWidth + dw;
        }
        if (active.axis === "both" || active.axis === "vertical") {
          height = active.startHeight + dh;
        }

        const clamped = clampSize(width, height);
        active.pendingWidth = clamped.width;
        active.pendingHeight = clamped.height;

        if (!active.rafId) {
          active.rafId = requestAnimationFrame(flush);
        }
      };

      const onPointerUp = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        flush();
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
        endSession(target, ev.pointerId);
      };

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);
    },
    [enabled, applySize, endSession]
  );

  return {
    isResizingRef,
    onResizePointerDown,
  };
}
