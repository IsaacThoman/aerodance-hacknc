export class AudioTransport {
  constructor() {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.positionMs = 0;
    this.rate = 1;
    this.active = false;
  }
  async contextReady() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }
  async load(bytes) {
    const context = await this.contextReady();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    this.pause();
    this.buffer = buffer;
    this.positionMs = 0;
    const channel = buffer.getChannelData(0),
      peaks = [];
    for (let i = 0; i < 300; i++) {
      const a = Math.floor((i * channel.length) / 300),
        b = Math.floor(((i + 1) * channel.length) / 300);
      let max = 0;
      for (let j = a; j < b; j += Math.max(1, Math.floor((b - a) / 200)))
        max = Math.max(max, Math.abs(channel[j]));
      peaks.push(max);
    }
    return { durationMs: Math.round(buffer.duration * 1000), peaks };
  }
  current() {
    return this.active
      ? this.positionMs +
          (this.context.currentTime - this.startTime) * 1000 * this.rate
      : this.positionMs;
  }
  async play(positionMs = 0, delaySeconds = 0, rate = 1) {
    if (!this.buffer) throw Error("Import song audio before playing");
    await this.contextReady();
    this.pause();
    this.positionMs = positionMs;
    this.rate = rate;
    this.startTime = this.context.currentTime + delaySeconds;
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = rate;
    this.source.connect(this.context.destination);
    this.source.start(this.startTime, Math.max(0, positionMs) / 1000);
    this.active = true;
  }
  pause() {
    if (this.active) this.positionMs = this.current();
    this.active = false;
    try {
      this.source?.stop();
    } catch {}
    this.source?.disconnect();
    this.source = null;
    return this.positionMs;
  }
  seek(time) {
    this.pause();
    this.positionMs = time;
  }
  dispose() {
    this.pause();
    this.context?.close();
  }
}
