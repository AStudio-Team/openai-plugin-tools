import { z } from "zod";
import { COLOR_ROLES, DIAGRAM_TYPES, DIRECTIONS } from "./types.js";

const safe = (max = 200) => z.string().min(1).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), "Unsafe control character").refine(value => !/\p{Extended_Pictographic}/u.test(value), "Emoji are not supported").refine(value => !/<\/?(?:script|iframe|object|embed)|(?:data|javascript):|\bon\w+\s*=/iu.test(value), "Unsafe markup or URL");
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const list = (maxItems: number, maxLength = 300) => z.array(safe(maxLength)).max(maxItems);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const briefSchema = z.object({
  schemaVersion: z.literal("1.0"), diagramType: z.enum(DIAGRAM_TYPES), title: safe(200), purpose: safe(1000), audience: safe(300), direction: z.enum(DIRECTIONS), detailLevel: z.enum(["concise", "standard", "detailed"]), theme: z.enum(["auto", "light", "dark"]), requiredItems: list(100), requiredRelationships: list(160), protectedTerms: list(100, 200), constraints: list(50, 500), assumptions: list(50, 500),
}).strict();
export const inferredBriefSchema = z.object({
  diagramType: z.enum(DIAGRAM_TYPES).nullable().optional(), title: safe(200).nullable().optional(), purpose: safe(1000).nullable().optional(), audience: safe(300).nullable().optional(), direction: z.enum(DIRECTIONS).default("auto"), detailLevel: z.enum(["concise", "standard", "detailed"]).default("standard"), theme: z.enum(["auto", "light", "dark"]).default("auto"), requiredItems: list(100).default([]), requiredRelationships: list(160).default([]), protectedTerms: list(100, 200).default([]), constraints: list(50, 500).default([]), assumptions: list(50, 500).default([]),
}).strict();
const position = z.object({ x: z.number().int().finite().min(-10000).max(10000), y: z.number().int().finite().min(-10000).max(10000) }).strict();
export const sceneSchema = z.object({
  schemaVersion: z.literal("1.0"), briefDigest: digestSchema, title: safe(200), diagramType: z.enum(DIAGRAM_TYPES),
  nodes: z.array(z.object({ id, label: safe(200), detail: safe(500).optional(), kind: z.enum(["start", "process", "decision", "system", "service", "database", "external", "actor", "concept", "note"]), groupId: id.optional(), order: z.number().int().min(0).max(999), colorRole: z.enum(COLOR_ROLES), protected: z.boolean().optional(), position: position.optional() }).strict()).min(1).max(100),
  edges: z.array(z.object({ id, from: id, to: id, label: safe(200).optional(), order: z.number().int().min(0).max(999), direction: z.enum(["forward", "both", "none"]), lineStyle: z.enum(["solid", "dashed", "dotted"]) }).strict()).max(160),
  groups: z.array(z.object({ id, label: safe(200), order: z.number().int().min(0).max(999), colorRole: z.enum(["primary", "processing", "storage"]) }).strict()).max(30), notes: list(50, 500),
}).strict();
export const editSchema = z.object({ op: z.enum(["move-node", "set-label", "set-edge-label", "set-color-role", "set-line-style", "set-direction"]), targetId: id, value: z.unknown() }).strict();

export function rejectDangerousKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Forbidden object key: ${key}`);
    rejectDangerousKeys((value as Record<string, unknown>)[key]);
  }
}
