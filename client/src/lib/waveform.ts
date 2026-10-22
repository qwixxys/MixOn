export const WAVEFORM_BARS = 150;

/** Decodes an audio file in the browser and returns normalised peak levels plus its duration. */
export async function analyseAudio(file: File, bars = WAVEFORM_BARS): Promise<{ peaks: number[]; duration: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, i) => buffer.getChannelData(i));
    const block = Math.max(1, Math.floor(buffer.length / bars));
    // Sampling ~2000 points per bar keeps analysis fast even for long files.
    const step = Math.max(1, Math.floor(block / 2000));
    const peaks: number[] = [];
    for (let b = 0; b < bars; b++) {
      let peak = 0;
      const start = b * block;
      const end = Math.min(buffer.length, start + block);
      for (const data of channels) {
        for (let i = start; i < end; i += step) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
      }
      peaks.push(peak);
    }
    const max = Math.max(...peaks) || 1;
    return { peaks: peaks.map((p) => Math.round((p / max) * 1000) / 1000), duration: buffer.duration };
  } finally {
    void ctx.close();
  }
}
