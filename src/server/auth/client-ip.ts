import { isIP } from "node:net";

/** Trust only a dedicated header overwritten by the configured reverse proxy. */
export function clientIp(headers: Pick<Headers, "get">, trustedHeader = process.env.AUTH_CLIENT_IP_HEADER): string {
  if (!trustedHeader) return "unknown";
  const value = headers.get(trustedHeader)?.trim();
  return value && isIP(value) ? value : "unknown";
}
