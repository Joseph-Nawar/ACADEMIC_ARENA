const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/u;
const CHARACTER_IDS = new Set(["omar", "mariam", "youssef", "amara", "tariq", "habiba2", "malek", "nour2", "zein"]);
const CHARACTER_FAMILIES = new Set(["ink", "cartoon3d"]);
const CHARACTER_TONES = new Set(["mint", "coral", "gold", "paper", "blue", "lilac"]);
const CHARACTER_BADGES = new Set(["✦", "⚡", "♥", "★", ""]);

export async function readJsonBody(request, maximumBytes = 4096) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("Content-Type") || "")) return null;
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeFictionalEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/u.test(normalized)) return null;
  return normalized;
}

export function isFictionalFixtureEmail(value) {
  return typeof value === "string" && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@academic-arena\.test$/u.test(value);
}

export function validLoginPassword(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function validNewPassword(value) {
  return typeof value === "string" && value.length >= 15 && value.length <= 128;
}

export function normalizeAvatar(value) {
  if (!hasExactKeys(value, ["base", "style", "tone", "badge"]) ||
      !CHARACTER_IDS.has(value.base) || !CHARACTER_FAMILIES.has(value.style) ||
      !CHARACTER_TONES.has(value.tone) || !CHARACTER_BADGES.has(value.badge)) {
    return null;
  }
  return { base: value.base, style: value.style, tone: value.tone, badge: value.badge };
}

export async function delayAuthenticationFailure(startedAt, minimumMilliseconds = 500) {
  const jitter = crypto.getRandomValues(new Uint16Array(1))[0] % 101;
  const remaining = minimumMilliseconds + jitter - (performance.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export function clientIpForRateLimit(request) {
  const value = request.headers.get("CF-Connecting-IP")?.trim() || "unknown-edge-client";
  if (value.length > 64 || /[\u0000-\u0020\u007f]/u.test(value)) return "invalid-edge-client";
  return value;
}
