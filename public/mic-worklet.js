import { createDownsampler } from './pcm-resample.js';

// Capture mono mic audio and emit 24 kHz PCM16. Playback stays silent: never monitor the mic.
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.downsampler = createDownsampler(sampleRate, 24000);
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
      for (const chunk of this.downsampler.push(mono)) {
        this.port.postMessage(chunk, [chunk.bytes]);
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
