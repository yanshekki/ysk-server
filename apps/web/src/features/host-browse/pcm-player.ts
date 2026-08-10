/**
 * Schedule s16le mono PCM chunks on Web Audio (host-browse live audio bridge).
 */

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private unlocked = false;

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Call from a user gesture (click) so browsers allow audio. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.unlocked = this.ctx.state === 'running';
      return this.unlocked;
    } catch {
      this.unlocked = false;
      return false;
    }
  }

  pushBase64S16le(b64: string, sampleRate: number): void {
    if (!this.ctx || !this.unlocked || this.ctx.state !== 'running') return;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.byteLength < 2) return;
      const int16 = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        f32[i] = int16[i] / 32768;
      }
      const sr = sampleRate > 0 ? sampleRate : this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, f32.length, sr);
      buf.copyToChannel(f32, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      const now = this.ctx.currentTime;
      if (this.nextTime < now + 0.02) this.nextTime = now + 0.02;
      src.start(this.nextTime);
      this.nextTime += buf.duration;
    } catch {
      /* ignore bad chunks */
    }
  }

  dispose(): void {
    this.unlocked = false;
    this.nextTime = 0;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
