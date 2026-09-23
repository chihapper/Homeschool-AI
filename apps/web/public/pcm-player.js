// AudioWorklet PCM player: robust streaming playback. Adapted from the character engine's
// web/pcm-player.js.
//
// A single node runs continuously and pulls mono Float32 PCM from an internal queue, emitting
// near-silence on underrun. Because the node never stops, the AudioContext does not "warm up" per
// reply (no clipped first word) and there are no per-buffer boundaries to click at. The main thread
// posts Float32Array chunks (already at the context sample rate); {type:"reset"} clears the queue.
// The node posts {type:"drained"} once it has played everything it was given, so the page knows
// when the tutor has actually finished speaking (audio arrives much faster than it plays).

class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.pos = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === "reset") {
        this.queue = [];
        this.cur = null;
        this.pos = 0;
        this.playing = false;
        return;
      }
      if (d && d.type === "status") {
        // The page asks after the last chunk arrived: if we already ran dry, say so now.
        if (!this.playing && !this.queue.length && (!this.cur || this.pos >= this.cur.length)) this.port.postMessage({ type: "drained" });
        return;
      }
      this.queue.push(d); // Float32Array
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    let i = 0;
    while (i < out.length) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.queue.shift() || null;
        this.pos = 0;
        if (!this.cur) {
          if (this.playing) {
            this.playing = false;
            this.port.postMessage({ type: "drained" });
          }
          // Underrun: inaudible dither (~-80 dBFS) rather than digital silence, so the OS audio
          // endpoint does not power down and clip the first samples when real audio resumes.
          while (i < out.length) out[i++] = (Math.random() - 0.5) * 1e-4;
          break;
        }
        this.playing = true;
      }
      out[i++] = this.cur[this.pos++];
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-player", PCMPlayer);
