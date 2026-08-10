/**
 * In-page audio capture for host-browse (HTMLMediaElement.captureStream → PCM).
 * Chunks are polled from window.__yskAudioQ by BrowserEngine.
 */

export type AudioPcmChunk = {
  /** Sample rate Hz */
  sampleRate: number;
  /** little-endian int16 mono PCM, base64 */
  pcmB64: string;
  channels: 1;
};

export type AudioBridgeStatus = {
  enabled: boolean;
  active: boolean;
  reason?: string;
};

/** Injected into the live page (same-origin media elements only when captureStream works). */
export const AUDIO_BRIDGE_BOOTSTRAP = `(() => {
  if (window.__yskHbAudioBoot) return;
  window.__yskHbAudioBoot = true;
  window.__yskAudioQ = window.__yskAudioQ || [];
  const MAX_Q = 40;
  const attach = (el) => {
    try {
      if (!el || el.__yskHbAudio) return;
      if (typeof el.captureStream !== 'function' && typeof el.mozCaptureStream !== 'function') return;
      el.__yskHbAudio = true;
      const getStream = () =>
        (el.captureStream && el.captureStream()) ||
        (el.mozCaptureStream && el.mozCaptureStream());
      const tryStart = () => {
        if (el.__yskHbAudioStarted) return;
        let stream;
        try {
          stream = getStream();
        } catch (e) {
          return;
        }
        if (!stream) return;
        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        if (!tracks.length) return;
        el.__yskHbAudioStarted = true;
        const astream = new MediaStream(tracks);
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const src = ctx.createMediaStreamSource(astream);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const bufSize = 2048;
        const proc = ctx.createScriptProcessor(bufSize, 1, 1);
        src.connect(proc);
        proc.connect(gain);
        gain.connect(ctx.destination);
        proc.onaudioprocess = (ev) => {
          try {
            const input = ev.inputBuffer.getChannelData(0);
            let peak = 0;
            for (let i = 0; i < input.length; i++) {
              const a = Math.abs(input[i]);
              if (a > peak) peak = a;
            }
            if (peak < 1e-5) return;
            const int16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              let s = input[i];
              if (s > 1) s = 1;
              else if (s < -1) s = -1;
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const u8 = new Uint8Array(int16.buffer);
            let bin = '';
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            window.__yskAudioQ.push({
              sr: ctx.sampleRate || 48000,
              pcm: btoa(bin),
              ch: 1,
            });
            if (window.__yskAudioQ.length > MAX_Q) {
              window.__yskAudioQ.splice(0, window.__yskAudioQ.length - MAX_Q);
            }
          } catch (e) { /* */ }
        };
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      };
      el.addEventListener('play', tryStart, { passive: true });
      el.addEventListener('playing', tryStart, { passive: true });
      if (!el.paused) tryStart();
    } catch (e) { /* */ }
  };
  const scan = () => {
    try {
      document.querySelectorAll('video, audio').forEach(attach);
    } catch (e) { /* */ }
  };
  scan();
  setInterval(scan, 1500);
  try {
    new MutationObserver(scan).observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  } catch (e) { /* */ }
})();`;

export function decodePcmB64(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}
