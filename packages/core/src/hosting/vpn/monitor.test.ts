import { describe, expect, it } from 'vitest';
import {
  matchOvpnControlPeer,
  parseOvpnStatus,
  parseWgDump,
  presenceFromHandshake,
  rateFromPrev,
  WG_ONLINE_HANDSHAKE_SEC,
} from './monitor.js';

describe('parseWgDump', () => {
  it('parses interface and peer lines', () => {
    const dump = [
      'wg0\tPRIV\tPUBSERVER\t51820\toff',
      'wg0\tPEERPUB\t(none)\t1.2.3.4:51820\t10.66.66.3/32\t1700000000\t1000\t2000\t25',
    ].join('\n');
    const p = parseWgDump(dump);
    expect(p.interfaces).toHaveLength(1);
    expect(p.interfaces[0].listenPort).toBe(51820);
    expect(p.peers).toHaveLength(1);
    expect(p.peers[0].publicKey).toBe('PEERPUB');
    expect(p.peers[0].transferRx).toBe(1000);
    expect(p.peers[0].transferTx).toBe(2000);
    expect(p.peers[0].latestHandshake).toBe(1700000000);
  });
});

describe('presenceFromHandshake', () => {
  it('classifies online idle never', () => {
    const now = 1_700_000_180;
    expect(presenceFromHandshake(now - 10, now)).toBe('online');
    expect(presenceFromHandshake(now - WG_ONLINE_HANDSHAKE_SEC - 10, now)).toBe(
      'idle',
    );
    expect(presenceFromHandshake(0, now)).toBe('never');
  });
});

describe('parseOvpnStatus', () => {
  it('parses CLIENT_LIST rows', () => {
    const text = [
      'TITLE,OpenVPN',
      'HEADER,CLIENT_LIST,Common Name,Real Address,Virtual Address,Virtual IPv6 Address,Bytes Received,Bytes Sent,Connected Since,Connected Since (time_t),Username,Client ID,Peer ID',
      'CLIENT_LIST,phone,8.8.8.8:1234,10.8.0.2,,500,600,2024-01-01 00:00:00,1700000000,phone,0,0',
      'END',
    ].join('\n');
    const rows = parseOvpnStatus(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].commonName).toBe('phone');
    expect(rows[0].bytesReceived).toBe(500);
    expect(rows[0].bytesSent).toBe(600);
    expect(rows[0].connectedSinceUnix).toBe(1700000000);
  });

  it('parses status-version 1 client list', () => {
    const text = [
      'OpenVPN CLIENT LIST',
      'Updated,Thu Jan 1 00:00:00 2024',
      'Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since',
      'ki-honor,127.0.0.1:1194,100,200,Thu Jan 1 00:00:00 2024',
      'ROUTING TABLE',
      'END',
    ].join('\n');
    const rows = parseOvpnStatus(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].commonName).toBe('ki-honor');
    expect(rows[0].bytesReceived).toBe(100);
  });
});

describe('matchOvpnControlPeer', () => {
  it('matches by CN and virtual IP', () => {
    const peers = [
      {
        id: '1',
        name: 'ki-honor',
        engine: 'openvpn' as const,
        address: '10.8.0.2/32',
        publicKey: '',
      },
    ];
    expect(
      matchOvpnControlPeer(
        {
          commonName: 'ki-honor',
          realAddress: '1.1.1.1:1',
          virtualAddress: '10.8.0.2',
          bytesReceived: 0,
          bytesSent: 0,
          connectedSinceUnix: 0,
          connectedSince: null,
        },
        peers,
      )?.id,
    ).toBe('1');
    expect(
      matchOvpnControlPeer(
        {
          commonName: 'other',
          realAddress: '',
          virtualAddress: '10.8.0.2',
          bytesReceived: 0,
          bytesSent: 0,
          connectedSinceUnix: 0,
          connectedSince: null,
        },
        peers,
      )?.id,
    ).toBe('1');
  });
});

describe('rateFromPrev', () => {
  it('computes bps from delta', () => {
    const prev = {
      atMs: 1000,
      byKey: { 'peer:a': { rx: 1000, tx: 2000 } },
    };
    const r = rateFromPrev('peer:a', 3000, 6000, 3000, prev);
    // 2000 bytes / 2s = 1000 B/s; 4000/2=2000
    expect(r.rxRateBps).toBe(1000);
    expect(r.txRateBps).toBe(2000);
  });

  it('returns null without prev', () => {
    expect(rateFromPrev('x', 1, 1, 1000, null).rxRateBps).toBeNull();
  });
});
