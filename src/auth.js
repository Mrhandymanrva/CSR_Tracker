// Shared-password HTTP Basic auth for hosted use. Server-side only.
import { timingSafeEqual, createHash } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

export const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1'].includes(host);

// Returns true when the request carries the right password (any user name). No password configured = no check.
export function authorized(header, password) {
  if (!password) return true;
  const m = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i >= 0 && safeEqual(decoded.slice(i + 1), password);
}
