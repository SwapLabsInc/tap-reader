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

function getBearerToken(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  if (match === null) {
    return null;
  }

  return match[1].trim();
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
  const bearerToken = getBearerToken(authHeader);
  if (bearerToken !== null) {
    return bearerToken;
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
    const bearerToken = getBearerToken(token);
    if (bearerToken !== null) {
      return bearerToken;
    }
    return token;
  }

  return getSuppliedApiKeyFromHeaders(socket?.handshake?.headers);
}
