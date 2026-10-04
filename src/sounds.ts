/**
 * sounds.ts – Low-latency, click-free audio cues for Flunkey.
 * Uses Web Audio API hardware clock scheduling (zero setTimeout jitter),
 * proper anti-click gain envelopes, lowpass filtering, and soft limiting.
 */

let ctx: AudioContext | null = null;
let masterFilter: BiquadFilterNode | null = null;
let masterLimiter: DynamicsCompressorNode | null = null;
let masterGain: GainNode | null = null;

export function initAudio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      // Master audio chain: Limiter -> Filter -> Master Gain -> Destination
      masterLimiter = ctx.createDynamicsCompressor();
      masterLimiter.threshold.setValueAtTime(-10, ctx.currentTime);
      masterLimiter.knee.setValueAtTime(4, ctx.currentTime);
      masterLimiter.ratio.setValueAtTime(10, ctx.currentTime);
      masterLimiter.attack.setValueAtTime(0.002, ctx.currentTime);
      masterLimiter.release.setValueAtTime(0.04, ctx.currentTime);

      // Gentle lowpass filter to remove digital aliasing/harshness
      masterFilter = ctx.createBiquadFilter();
      masterFilter.type = "lowpass";
      masterFilter.frequency.setValueAtTime(3400, ctx.currentTime);
      masterFilter.Q.setValueAtTime(0.7, ctx.currentTime);

      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.9, ctx.currentTime);

      masterLimiter.connect(masterFilter);
      masterFilter.connect(masterGain);
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  } catch {
    return null;
  }
}

function getCtx(): AudioContext | null {
  return initAudio();
}

/**
 * Schedules an anti-click synthesized tone directly on the Web Audio hardware timeline.
 * Never uses setTimeout, preventing JS event-loop stutter.
 */
function scheduleTone(
  startTime: number,
  freqStart: number,
  freqEnd: number,
  durationMs: number,
  gainPeak: number,
  type: OscillatorType = "sine"
) {
  const c = getCtx();
  if (!c || !masterLimiter) return;

  const start = Math.max(c.currentTime, startTime);
  const dur = durationMs / 1000;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;

  // Frequency envelope
  osc.frequency.setValueAtTime(freqStart, start);
  if (Math.abs(freqEnd - freqStart) > 1) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + dur * 0.85);
  }

  // Anti-click volume envelope:
  // 1. Start strictly at 0
  // 2. Linear micro-ramp to peak (5ms attack)
  // 3. Natural exponential decay towards floor
  // 4. Clean linear ramp to absolute 0 before cutoff
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0004, start + dur);
  gain.gain.linearRampToValueAtTime(0, start + dur + 0.006);

  osc.connect(gain);
  gain.connect(masterLimiter);

  osc.start(start);
  osc.stop(start + dur + 0.01);

  osc.onended = () => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {}
  };
}

/**
 * Warm, subtle rising chime when voice dictation / AI query begins.
 * Scheduled precisely on the hardware clock with a faint harmonic overtone.
 */
export function playStartSound() {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + 0.005;

  // Primary warm rise: D5 -> A5
  scheduleTone(t0, 587.33, 880.0, 115, 0.065, "sine");
  // Gentle harmonic overtone for acoustic shimmer: A5 -> D6
  scheduleTone(t0 + 0.024, 880.0, 1174.66, 95, 0.026, "sine");
}

/**
 * Affirmative, crisp ascending tone when dictation stops and processing starts.
 * Sounds satisfying and successful rather than like an error/drop.
 */
export function playStopSound() {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + 0.005;

  // Affirmative crisp ascending chime: G5 -> C6
  scheduleTone(t0, 783.99, 1046.5, 75, 0.042, "sine");
  // Gentle harmonic shimmer: C6 -> E6
  scheduleTone(t0 + 0.016, 1046.5, 1318.51, 65, 0.02, "sine");
}

/**
 * Subtle low descending step on cancellation.
 */
export function playCancelSound() {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + 0.005;

  scheduleTone(t0, 392.0, 329.63, 85, 0.04, "sine");
  scheduleTone(t0 + 0.025, 293.66, 246.94, 90, 0.025, "sine");
}

/**
 * Crisp, affirmative two-tone chord on confirmation / paste.
 */
export function playConfirmSound() {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + 0.005;

  // E5 -> B5 major fifth success chime
  scheduleTone(t0, 659.25, 659.25, 80, 0.055, "sine");
  scheduleTone(t0 + 0.038, 987.77, 987.77, 110, 0.065, "sine");
  scheduleTone(t0 + 0.042, 1318.5, 1318.5, 80, 0.018, "sine");
}
