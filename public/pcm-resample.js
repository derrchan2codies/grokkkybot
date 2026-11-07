// Stream Float32 mono audio to PCM16. Conversational agents default to 16 kHz.
export function createDownsampler(inputRate, outputRate = 16000, chunkSize = 480) {
  if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error('Invalid microphone sample rate.');
  if (!Number.isFinite(outputRate) || outputRate <= 0) throw new Error('Invalid output sample rate.');
  const ratio = inputRate / outputRate;
  let buffer = new Float32Array(0);
  let position = 0;

  return {
    push(mono) {
      if (!mono?.length) return [];
      const merged = new Float32Array(buffer.length + mono.length);
      merged.set(buffer, 0);
      merged.set(mono, buffer.length);
      buffer = merged;
      const chunks = [];
      while (position + (chunkSize - 1) * ratio + 1 < buffer.length) {
        const pcm = new Int16Array(chunkSize);
        let energy = 0;
        for (let i = 0; i < chunkSize; i++) {
          const pos = position + i * ratio;
          const index = Math.floor(pos);
          const frac = pos - index;
          const left = buffer[index];
          const right = buffer[index + 1];
          const sample = left + (right - left) * frac;
          const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
          energy += clamped * clamped;
          pcm[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
        }
        position += chunkSize * ratio;
        chunks.push({ bytes: pcm.buffer, level: Math.sqrt(energy / chunkSize) });
      }
      const drop = Math.max(0, Math.floor(position) - 1);
      if (drop > 0) {
        buffer = buffer.slice(drop);
        position -= drop;
      }
      return chunks;
    }
  };
}
