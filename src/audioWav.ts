/**
 * audioWav.ts — turn a recorded clip into the exact format whisper.cpp wants.
 *
 * The recorder captures `audio/webm;codecs=opus`, but whisper.cpp reads WAV.
 * WebView2 is Chromium, so it can decode that container/codec natively: we
 * decode, resample to 16 kHz through an OfflineAudioContext, downmix to mono,
 * and write a 16-bit PCM WAV header by hand. No native decoder, no ffmpeg.
 *
 * Only the local STT path pays for this — cloud providers get the original
 * compressed blob.
 */

const TARGET_SAMPLE_RATE = 16_000;

/** Decode any browser-supported audio blob to mono 16 kHz 16-bit PCM WAV. */
export async function blobToWav16kMono(blob: Blob): Promise<Uint8Array> {
  const bytes = await blob.arrayBuffer();

  // decodeAudioData resamples to the context's rate for us.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
  } finally {
    void decodeCtx.close();
  }

  if (decoded.duration < 0.2) {
    throw new Error("The clip was too short to transcribe.");
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  // Downmix + resample in one step.
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return encodeWav16(rendered);
}

function encodeWav16(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const dataBytes = frames * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // chunk size
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : null;
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    // Average channels so a headset mic on one side isn't halved.
    const sample = right ? (left[i] + right[i]) / 2 : left[i];
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
    offset += 2;
  }
  return out;
}
