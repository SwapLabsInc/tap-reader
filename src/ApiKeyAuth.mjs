import { timingSafeEqual } from "node:crypto";

function normalizeHeaderValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && value.length > 0) {
    return normalizeHeaderValue(value[0]);
  }

  return "";
}

export function apiKeysMatch(expectedApiKey, suppliedApiKey) {
  if (!suppliedApiKey) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedApiKey);
  const suppliedBuffer = Buffer.from(suppliedApiKey);

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function getSuppliedApiKeyFromHeaders(headers = {}) {
  const headerApiKey = normalizeHeaderValue(headers["x-api-key"]);
  if (headerApiKey.length > 0) {
    return headerApiKey;
  }

  const authHeader = normalizeHeaderValue(headers.authorization);
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return null;
}

export function getSuppliedApiKeyFromRequest(request) {
  return getSuppliedApiKeyFromHeaders(request?.headers);
}

export function getSuppliedApiKeyFromSocket(socket) {
  const auth = socket?.handshake?.auth ?? {};

  if (typeof auth.apiKey === "string" && auth.apiKey.trim().length > 0) {
    return auth.apiKey.trim();
  }

  if (typeof auth.token === "string" && auth.token.trim().length > 0) {
    const token = auth.token.trim();
    if (token.startsWith("Bearer ")) {
      return token.slice("Bearer ".length).trim();
    }
    return token;
  }

  return getSuppliedApiKeyFromHeaders(socket?.handshake?.headers);
}
