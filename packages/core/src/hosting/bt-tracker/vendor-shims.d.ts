/**
 * Ambient declarations for optional BT/WebTorrent deps (no official @types).
 * Runtime packages: webtorrent, bittorrent-tracker, create-torrent, parse-torrent.
 */

declare module 'webtorrent' {
  type WtTorrent = {
    infoHash?: string;
    name?: string;
    length?: number;
    numPeers?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    downloaded?: number;
    uploaded?: number;
    progress?: number;
    paused?: boolean;
    done?: boolean;
    files?: Array<{ path?: string; name?: string; length?: number }>;
    announce?: string[];
    pause?: () => void;
    resume?: () => void;
    addTracker?: (url: string) => void;
    destroy?: (opts?: { destroyStore?: boolean }, cb?: () => void) => void;
    on?: (ev: string, fn: (...a: unknown[]) => void) => void;
  };

  type WtClient = {
    add: (
      torrentId: string | Buffer,
      opts: Record<string, unknown>,
      cb?: (torrent: WtTorrent) => void,
    ) => WtTorrent;
    destroy: (cb?: (err?: Error) => void) => void;
  };

  const WebTorrent: {
    new (opts?: Record<string, unknown>): WtClient;
    default?: new (opts?: Record<string, unknown>) => WtClient;
  };
  export default WebTorrent;
}

declare module 'bittorrent-tracker' {
  type TrackerServerOpts = {
    udp?: boolean;
    http?: boolean;
    ws?: boolean;
    stats?: boolean;
    filter?: (
      infoHash: Buffer,
      params: unknown,
      cb: (err: Error | null) => void,
    ) => void;
  };

  class Server {
    constructor(opts?: TrackerServerOpts);
    http?: { address?: () => { port: number } | string | null; close: (cb?: () => void) => void };
    udp?: { close: (cb?: () => void) => void };
    ws?: { close: (cb?: () => void) => void };
    close: (cb?: (err?: Error) => void) => void;
    listen: (port: number, host?: string | (() => void), cb?: () => void) => void;
    on: (ev: string, fn: (...args: unknown[]) => void) => void;
  }

  export { Server };
}

declare module 'create-torrent' {
  function createTorrent(
    path: string,
    opts: Record<string, unknown>,
    cb: (err: Error | null, torrent?: Buffer) => void,
  ): void;
  export default createTorrent;
}

declare module 'bencode' {
  export function encode(data: unknown): Buffer;
  export function decode(data: Buffer | Uint8Array): unknown;
  const bencode: { encode: typeof encode; decode: typeof decode };
  export default bencode;
}

declare module 'parse-torrent' {
  type ParsedTorrent = {
    infoHash?: string | Buffer;
    name?: string;
    length?: number;
    announce?: string[];
    private?: boolean;
    files?: Array<{ path?: string; name?: string; length?: number }>;
  };
  function parseTorrent(input: Buffer | string): ParsedTorrent;
  export default parseTorrent;
}
