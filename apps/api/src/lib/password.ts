/**
 * Password hashing sized for the Cloudflare Workers free plan.
 *
 * The free plan allows 10 ms of CPU per invocation. Measured inside workerd,
 * better-auth's default scrypt parameters cost about 30 ms to hash and 29 ms to
 * verify, so sign-up and sign-in would be killed before they finished. PBKDF2
 * through WebCrypto costs about 5 ms at 100,000 iterations and about 12 ms at
 * 210,000 on the same machine.
 *
 * So the default is 100,000 PBKDF2-HMAC-SHA256 iterations. That is below the
 * 600,000 OWASP currently suggests for this algorithm, and it is a deliberate
 * trade against a hard platform limit rather than an oversight. Deployments on
 * the Workers Paid plan should raise PASSWORD_KDF_ITERATIONS to 600000, which
 * costs about 35 ms and is comfortably inside the paid CPU budget. The
 * iteration count is stored in each hash, so raising it never locks out an
 * existing account: old hashes keep verifying at their original cost and are
 * rewritten at the new cost on the next successful sign-in.
 */

const ALGORITHM = "pbkdf2";
const DIGEST = "sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

export const FREE_TIER_ITERATIONS = 100_000;
export const PAID_TIER_ITERATIONS = 600_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Comparison whose running time does not depend on where the bytes differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, iterations);
  return [ALGORITHM, DIGEST, iterations, toBase64(salt), toBase64(derived)].join("$");
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 5) return false;
  const [algorithm, digest, iterationsRaw, saltRaw, expectedRaw] = parts;
  if (algorithm !== ALGORITHM || digest !== DIGEST) return false;

  const iterations = Number.parseInt(iterationsRaw ?? "", 10);
  if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 2_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(saltRaw ?? "");
    expected = fromBase64(expectedRaw ?? "");
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** Reads the iteration count a stored hash was produced with. */
export function iterationsOf(hash: string): number | null {
  const raw = hash.split("$")[2];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}
