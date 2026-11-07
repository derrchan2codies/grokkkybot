import { DEFAULT_INPUT_RATE } from './agent-session.js';
import { createDownsampler } from './pcm-resample.js';

// Capture mono mic audio and emit PCM16 at the agent's input rate. Playback stays silent.
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outputRate = DEFAULT_INPUT_RATE;
    this.downsampler = createDownsampler(sampleRate, this.outputRate);
    this.port.onmessage = (event) => {
      const rate = event.data?.outputRate;
      if (!Number.isFinite(rate) || rate <= 0 || rate === this.outputRate) return;
      this.outputRate = rate;
      this.downsampler = createDownsampler(sampleRate, rate);
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0];
    if (channels?.length && channels[0]?.length) {
      const frames = channels[0].length;
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i];
        mono[i] = sample / channels.length;
      }
      const rate = this.outputRate;
      for (const chunk of this.downsampler.push(mono)) {
        this.port.postMessage({ ...chunk, rate }, [chunk.bytes]);
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
