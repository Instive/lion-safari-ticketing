import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, parallelism 1).
const options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, options);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, options);
  } catch {
    // A malformed hash must read as "wrong password", never as an app crash.
    return false;
  }
}
