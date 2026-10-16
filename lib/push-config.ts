import { createECDH } from 'node:crypto';

export function validateVapidPair(publicKey: string, privateKey: string, browserPublicKey?: string) {
  try {
    if (browserPublicKey && browserPublicKey !== publicKey) return false;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    const expected = ecdh.getPublicKey().toString('base64url');
    return expected === publicKey.replace(/=+$/, '');
  } catch { return false; }
}