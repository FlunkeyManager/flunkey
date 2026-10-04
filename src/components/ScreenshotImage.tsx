import { useEffect, useState } from "react";
import { resolveScreenshot } from "../sessionUtils";

/**
 * Render a stored screenshot.
 *
 * `src` in history is now a filename rather than a base64 data URL, so the
 * bytes have to be read back before the browser can display them. Older
 * sessions still hold inline data URLs; `resolveScreenshot` passes those
 * through untouched, so this works for both shapes.
 *
 * A missing file renders a short note instead of a broken-image icon: the user
 * deleted it or the folder was cleared, and neither is worth an error dialog.
 */
export function ScreenshotImage({
  reference,
  alt,
  className,
}: {
  reference: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setMissing(false);
    resolveScreenshot(reference).then((resolved) => {
      if (cancelled) return;
      if (resolved) setUrl(resolved);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (missing) {
    return (
      <div className="chat-screenshot chat-screenshot--missing">
        Screenshot no longer available
      </div>
    );
  }
  if (!url) return null;
  return <img className={className} src={url} alt={alt} />;
}