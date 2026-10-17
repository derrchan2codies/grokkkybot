// Continuously capture mono PCM16 at the AudioContext sample rate.
// The main thread forwards frames throughout the session, including during replies.
class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Float32Array(480); this.used = 0; }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0); // Never monitor the mic.
    const channels = inputs[0];
    if (channels?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i];
        this.samples[this.used++] = sample / channels.length;
        if (this.used === this.samples.length) {
          const bytes = new ArrayBuffer(this.used * 2);
          const view = new DataView(bytes);
          let energy = 0;
          for (let j = 0; j < this.used; j++) {
            const value = Math.max(-1, Math.min(1, this.samples[j]));
            energy += value * value;
            view.setInt16(j * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
          }
          this.port.postMessage({ bytes, level: Math.sqrt(energy / this.used) }, [bytes]);
          this.used = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
