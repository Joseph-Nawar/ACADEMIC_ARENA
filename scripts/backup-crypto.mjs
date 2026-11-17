// Authenticated encryption for database exports: scrypt (N=2^17) + AES-256-GCM.
// Usage: node scripts/backup-crypto.mjs encrypt|decrypt <in> <out>
// The passphrase comes from AA_BACKUP_PASSPHRASE (set by db-backup.sh from a
// hidden prompt or a 0600 file) and is never printed or passed in argv.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const MAGIC = Buffer.from("AABK1");
const [mode, input, output] = process.argv.slice(2);
const passphrase = process.env.AA_BACKUP_PASSPHRASE || "";
delete process.env.AA_BACKUP_PASSPHRASE;
if (!["encrypt", "decrypt"].includes(mode) || !input || !output) {
  console.error("usage: backup-crypto.mjs encrypt|decrypt <in> <out>");
  process.exit(2);
}
if (passphrase.length < 24) {
  console.error("The backup passphrase must be at least 24 characters (use a generated passphrase).");
  process.exit(2);
}
const derive = (salt) => scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

if (mode === "encrypt") {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(readFileSync(input)), cipher.final()]);
  writeFileSync(output, Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]), { mode: 0o600, flag: "wx" });
} else {
  const data = readFileSync(input);
  if (data.length < MAGIC.length + 16 + 12 + 16 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    console.error("Not an Academic Arena backup file.");
    process.exit(1);
  }
  const salt = data.subarray(5, 21);
  const iv = data.subarray(21, 33);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", derive(salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(data.subarray(33, data.length - 16)), decipher.final()]);
    writeFileSync(output, plain, { mode: 0o600, flag: "wx" });
  } catch {
    console.error("Decryption failed: wrong passphrase or the file was modified.");
    process.exit(1);
  }
}
