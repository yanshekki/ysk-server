import { tl } from '@yanshekki/shared';
/**
 * WebAuthn / passkey (panel second factor) via @simplewebauthn/server v13.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { JsonStore } from '../../db/store.js';
import { randomBytes } from 'node:crypto';

export type WebAuthnCredentialRow = {
  id: string;
  credentialID: string;
  credentialPublicKey: string; // base64url
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  created_at: string;
  name?: string;
};

export type WebAuthnUserBlob = {
  credentials: WebAuthnCredentialRow[];
  currentChallenge?: string;
};

const RP_NAME = 'YSK Server';

function getRpID(origin?: string): string {
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      /* */
    }
  }
  return process.env.YSK_RP_ID || 'localhost';
}

function getOrigin(origin?: string): string {
  return origin || process.env.YSK_ORIGIN || 'http://127.0.0.1:9173';
}

function loadBlob(db: JsonStore, userId: string): WebAuthnUserBlob {
  const raw = db.snapshot.settings[`webauthn.${userId}`];
  if (!raw) return { credentials: [] };
  try {
    return JSON.parse(raw) as WebAuthnUserBlob;
  } catch {
    return { credentials: [] };
  }
}

function saveBlob(db: JsonStore, userId: string, blob: WebAuthnUserBlob): void {
  db.snapshot.settings[`webauthn.${userId}`] = JSON.stringify(blob);
  db.persist();
}

export function listWebAuthnCredentials(db: JsonStore, userId: string) {
  return loadBlob(db, userId).credentials.map((c) => ({
    id: c.id,
    name: c.name || 'Passkey',
    created_at: c.created_at,
    transports: c.transports,
  }));
}

export async function beginWebAuthnRegistration(input: {
  db: JsonStore;
  userId: string;
  username: string;
  origin?: string;
}) {
  const blob = loadBlob(input.db, input.userId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(input.origin),
    userName: input.username,
    userDisplayName: input.username,
    userID: new TextEncoder().encode(input.userId),
    attestationType: 'none',
    excludeCredentials: blob.credentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  blob.currentChallenge = options.challenge;
  saveBlob(input.db, input.userId, blob);
  return options;
}

export async function finishWebAuthnRegistration(input: {
  db: JsonStore;
  userId: string;
  response: RegistrationResponseJSON;
  origin?: string;
  name?: string;
}) {
  const blob = loadBlob(input.db, input.userId);
  if (!blob.currentChallenge) {
    return { ok: false as const, notes: [tl('notes.auto.n1084')] };
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: blob.currentChallenge,
      expectedOrigin: getOrigin(input.origin),
      expectedRPID: getRpID(input.origin),
      requireUserVerification: false,
    });
  } catch (e) {
    blob.currentChallenge = undefined;
    saveBlob(input.db, input.userId, blob);
    return {
      ok: false as const,
      notes: [e instanceof Error ? e.message : 'registration verify error'],
    };
  }
  blob.currentChallenge = undefined;
  if (!verification.verified || !verification.registrationInfo) {
    saveBlob(input.db, input.userId, blob);
    return { ok: false as const, notes: [tl('notes.auto.n0205')] };
  }
  const cred = verification.registrationInfo.credential;
  const row: WebAuthnCredentialRow = {
    id: randomBytes(8).toString('hex'),
    credentialID: cred.id,
    credentialPublicKey: Buffer.from(cred.publicKey).toString('base64url'),
    counter: cred.counter,
    transports: cred.transports,
    created_at: new Date().toISOString(),
    name: input.name?.trim() || 'Passkey',
  };
  blob.credentials.push(row);
  saveBlob(input.db, input.userId, blob);
  return {
    ok: true as const,
    credential: { id: row.id, name: row.name },
    notes: [tl('notes.auto.n0367')],
  };
}

export async function beginWebAuthnAuthentication(input: {
  db: JsonStore;
  userId: string;
  origin?: string;
}) {
  const blob = loadBlob(input.db, input.userId);
  if (!blob.credentials.length) {
    return { ok: false as const, notes: [tl('notes.auto.n0712')] };
  }
  const options = await generateAuthenticationOptions({
    rpID: getRpID(input.origin),
    allowCredentials: blob.credentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports,
    })),
    userVerification: 'preferred',
  });
  blob.currentChallenge = options.challenge;
  saveBlob(input.db, input.userId, blob);
  return { ok: true as const, options };
}

export async function finishWebAuthnAuthentication(input: {
  db: JsonStore;
  userId: string;
  response: AuthenticationResponseJSON;
  origin?: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const blob = loadBlob(input.db, input.userId);
  if (!blob.currentChallenge) {
    return { ok: false, notes: [tl('notes.auto.n1072')] };
  }
  const use = blob.credentials.find((c) => c.credentialID === input.response.id);
  if (!use) {
    return { ok: false, notes: [tl('notes.auto.n0964')] };
  }
  try {
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: blob.currentChallenge,
      expectedOrigin: getOrigin(input.origin),
      expectedRPID: getRpID(input.origin),
      requireUserVerification: false,
      credential: {
        id: use.credentialID,
        publicKey: Buffer.from(use.credentialPublicKey, 'base64url'),
        counter: use.counter,
        transports: use.transports,
      },
    });
    blob.currentChallenge = undefined;
    if (!verification.verified) {
      saveBlob(input.db, input.userId, blob);
      return { ok: false, notes: [tl('notes.auto.n0368')] };
    }
    use.counter = verification.authenticationInfo.newCounter;
    saveBlob(input.db, input.userId, blob);
    return { ok: true, notes: [tl('notes.auto.n0369')] };
  } catch (e) {
    blob.currentChallenge = undefined;
    saveBlob(input.db, input.userId, blob);
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : 'passkey verify error'],
    };
  }
}

export function deleteWebAuthnCredential(
  db: JsonStore,
  userId: string,
  credRowId: string,
): boolean {
  const blob = loadBlob(db, userId);
  const before = blob.credentials.length;
  blob.credentials = blob.credentials.filter((c) => c.id !== credRowId);
  saveBlob(db, userId, blob);
  return blob.credentials.length < before;
}
