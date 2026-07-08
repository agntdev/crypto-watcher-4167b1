import { randomUUID } from "node:crypto";

/**
 * UUID v4 generator — delegates to Node's crypto.randomUUID.
 */
export function v4(): string {
  return randomUUID();
}