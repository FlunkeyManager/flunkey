/**
 * recorder.ts – Thin wrapper around the browser MediaRecorder API.
 * Captures microphone audio and returns a WebM Blob when stopped.
 *
 * State is captured per recording rather than shared in module scope. The
 * previous version reset a module-level chunk array in `startRecording` and
 * read the module-level `mediaRecorder` inside `onstop`, so pressing the F8
 * hotkey again while a dictation was still being transcribed built the first
 * clip from the *second* recording's chunks and stopped the *second*
 * recording's microphone track. The user got a garbled paste and lost the
 * second dictation entirely.
 */

interface ActiveRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  settled: boolean;
}

let active: ActiveRecording | null = null;

/** Release the microphone and forget the recording, if there is one. */
function discardActive(): void {
  if (!active) return;
  active.stream.getTracks().forEach((track) => track.stop());
  active = null;
}

export function isRecording(): boolean {
  return active !== null;
}

export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export async function startRecording(): Promise<void> {
  if (active) {
    // Starting twice would orphan the first recording's audio and hold the
    // mic open with nothing referencing it.
    throw new Error("Already recording");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    const recording: ActiveRecording = {
      recorder,
      stream,
      chunks,
      settled: false,
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();
    active = recording;
  } catch (e) {
    // Don't leak the mic track if the recorder fails to start.
    stream.getTracks().forEach((track) => track.stop());
    throw e;
  }
}

export function stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const recording = active;
    if (!recording) {
      reject(new Error("No active recording"));
      return;
    }
    const { recorder, stream, chunks } = recording;
    recorder.onstop = () => {
      // Everything below refers to the captured `recording`, so a newer
      // recording started in the meantime cannot change this one's result.
      const blob = new Blob(chunks, { type: "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      if (active === recording) active = null;
      resolve(blob);
    };
    recorder.stop();
  });
}

/** Abandon the current recording without producing audio. */
export function cancelRecording(): void {
  discardActive();
}