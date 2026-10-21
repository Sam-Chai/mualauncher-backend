import { invariant } from "./errors";
import type { Role } from "@/generated/prisma/client";

export type Input = Record<string, unknown>;
export function fields(value: unknown, allowed: string[]): Input {
  invariant(value && typeof value === "object" && !Array.isArray(value), 400, "请求必须是 JSON 对象");
  const data = value as Input;
  invariant(Object.keys(data).every(key => allowed.includes(key)), 400, "请求包含不允许的字段");
  return data;
}
export function text(data: Input, key: string, max = 200, required = true): string {
  const value = data[key];
  invariant(typeof value === "string", 400, `${key} 必须是文本`);
  const result = value.trim();
  invariant(result.length <= max && (!required || result.length > 0), 400, `${key} 长度不符合要求`);
  return result;
}
export function optionalText(data: Input, key: string, max = 500) {
  return data[key] === null || data[key] === "" ? null : text(data, key, max);
}
export function bool(data: Input, key: string) {
  invariant(typeof data[key] === "boolean", 400, `${key} 必须是布尔值`);
  return data[key] as boolean;
}
export function uuid(value: string) {
  invariant(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), 400, "无效的内部 ID");
  return value;
}
export function serverId(value: string) {
  invariant(/^[A-Za-z]{3,5}$/.test(value), 400, "MUA server ID 必须是 3–5 位英文字母");
  return value;
}
export function clientId(value: string) {
  return uuid(value);
}
export function username(value: string) {
  const result = value.trim().toLowerCase();
  invariant(/^[a-z0-9_.-]{3,64}$/.test(result), 400, "用户名须为 3–64 位英文字母、数字或 _ . -");
  return result;
}
export function password(value: unknown) {
  invariant(typeof value === "string" && value.length >= 12 && value.length <= 128, 400, "密码长度须为 12–128 位");
  return value;
}
export const roleCodes: Role[] = ["PLAYER", "ORG_ADMIN", "SERVER_ADMIN", "CLIENT_EDITOR", "SERVER_EDITOR", "REVIEWER", "PUBLISHER", "RELEASE_OPERATOR", "READ_ONLY"];
export function roles(value: unknown): Role[] {
  invariant(Array.isArray(value) && value.every(role => roleCodes.includes(role)), 400, "角色无效");
  return [...new Set(value)] as Role[];
}
