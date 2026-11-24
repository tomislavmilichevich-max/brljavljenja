// A5: potpisana odluka o odobrenju (HMAC-SHA256, WebCrypto). Ključ za potpis daje vlasnik lokalno (NIKAD u repozitoriju).
// Odobrenje veže: projekt, kućanstvo, hash manifesta, hash usklađenog plana, hash snapshota i točan Firebase UID.
import { canonical } from './canonical.ts';

export interface Approval {
  project: string;
  household: string;
  manifestHash: string;
  reconciledHash: string;
  snapshotHash: string;
  uid: string; // točan Firebase UID (e-mail se NIKAD ne koristi kao identitet)
}
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export async function signApproval(a: Approval, key: string): Promise<string> {
  if (key.length < 16) throw new Error('KEY_TOO_SHORT');
  return hmac(key, canonical(a));
}
export async function verifyApproval(
  a: Approval,
  signature: string,
  key: string,
): Promise<boolean> {
  if (key.length < 16 || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const want = await hmac(key, canonical(a));
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
