import { CompactEncrypt, compactDecrypt } from "jose";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) return new Uint8Array();
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export function randomOpaqueToken() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Bytea(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return `\\x${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function hmacSha256Bytea(value, keyValue) {
  const key = await crypto.subtle.importKey("raw", decodeBase64Url(keyValue), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return `\\x${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function constantTimeMatchesPostgresBytea(leftBytea, rightBytea) {
  const left = typeof leftBytea === "string" ? leftBytea.replace(/^\\x/u, "").toLowerCase() : "";
  const right = typeof rightBytea === "string" ? rightBytea.replace(/^\\x/u, "").toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function encryptSessionSecret(value, keyValue, type) {
  const key = decodeBase64Url(keyValue);
  if (key.byteLength !== 32 || typeof value !== "string" || value.length === 0) throw new Error("Session encryption is unavailable.");
  return new CompactEncrypt(encoder.encode(value))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: type })
    .encrypt(key);
}

export async function decryptSessionSecret(encryptedValue, keyValue, type) {
  const key = decodeBase64Url(keyValue);
  if (key.byteLength !== 32 || typeof encryptedValue !== "string") throw new Error("Session decryption is unavailable.");
  const decrypted = await compactDecrypt(encryptedValue, key);
  if (decrypted.protectedHeader.alg !== "dir" || decrypted.protectedHeader.enc !== "A256GCM" || decrypted.protectedHeader.typ !== type) {
    throw new Error("Session ciphertext header is invalid.");
  }
  return decoder.decode(decrypted.plaintext);
}
