import AjvModule from "ajv";
import type { ErrorObject } from "ajv";
import type { DiagramBrief, DiagramScene, ExcalidrawDocument } from "./types.js";

const documentSchema = {
  type: "object", additionalProperties: false, required: ["type", "version", "source", "elements", "appState", "files"],
  properties: {
    type: { const: "excalidraw" }, version: { const: 2 }, source: { const: "editable-diagram-builder" }, files: { type: "object", maxProperties: 0 },
    appState: { type: "object", additionalProperties: false, required: ["viewBackgroundColor"], properties: { viewBackgroundColor: { enum: ["#ffffff", "#121212"] } } },
    elements: { type: "array", maxItems: 1000, items: { type: "object", required: ["id", "type", "x", "y", "width", "height"], properties: { id: { type: "string" }, type: { enum: ["rectangle", "ellipse", "diamond", "arrow", "text"] }, x: { type: "number" }, y: { type: "number" }, width: { type: "number", minimum: 0 }, height: { type: "number", minimum: 0 } } } }
  }
} as const;
const Ajv = AjvModule as unknown as new (options?: Record<string, unknown>) => { compile(schema: unknown): ((data: unknown) => boolean) & { errors?: ErrorObject[] | null } };
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(documentSchema);

export function validateScene(scene: DiagramScene, brief?: DiagramBrief): void {
  const ids = new Set<string>();
  const orders: Record<string, Set<number>> = { nodes: new Set(), edges: new Set(), groups: new Set() };
  for (const [kind, values] of Object.entries({ nodes: scene.nodes, edges: scene.edges, groups: scene.groups })) for (const value of values) {
    if (ids.has(value.id)) throw new Error(`Duplicate ID: ${value.id}`); ids.add(value.id);
    if (orders[kind]!.has(value.order)) throw new Error(`Duplicate ${kind} order: ${value.order}`); orders[kind]!.add(value.order);
  }
  const nodes = new Set(scene.nodes.map(node => node.id)); const groups = new Set(scene.groups.map(group => group.id));
  for (const node of scene.nodes) if (node.groupId && !groups.has(node.groupId)) throw new Error(`Unknown group: ${node.groupId}`);
  for (const edge of scene.edges) if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error(`Dangling edge: ${edge.id}`);
  if (brief) {
    if (scene.diagramType !== brief.diagramType) throw new Error("Scene diagram type does not match approved brief");
    const corpus = [scene.title, ...scene.nodes.flatMap(node => [node.label, node.detail || ""]), ...scene.edges.map(edge => edge.label || ""), ...scene.groups.map(group => group.label), ...scene.notes].join("\n").normalize("NFC");
    for (const term of brief.protectedTerms) if (!corpus.includes(term.normalize("NFC"))) throw new Error(`Protected term missing: ${term}`);
  }
}

export function validateDocument(document: ExcalidrawDocument, protectedTerms: string[] = []): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  if (!validateSchema(document)) errors.push(...(validateSchema.errors || []).map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`));
  const ids = new Set<string>(); const byId = new Map(document.elements.map(element => [element.id, element]));
  for (const element of document.elements) {
    if (ids.has(element.id)) errors.push(`Duplicate element ID: ${element.id}`); ids.add(element.id);
    for (const key of ["x", "y", "width", "height"] as const) if (!Number.isFinite(element[key]) || Math.abs(element[key]) > 20000) errors.push(`Invalid geometry: ${element.id}.${key}`);
    if (element.type === "text") { if (Number(element.fontSize) < 14) errors.push(`Font too small: ${element.id}`); if (element.originalText !== element.text) errors.push(`Text mismatch: ${element.id}`); const containerId = element.containerId as string | null; if (containerId) { const container = byId.get(containerId); if (!container || !(container.boundElements as Array<{id:string}> || []).some(binding => binding.id === element.id)) errors.push(`One-sided text binding: ${element.id}`); } }
    if (element.type === "arrow") { const points = element.points as number[][]; if (!Array.isArray(points) || points[0]?.[0] !== 0 || points[0]?.[1] !== 0) errors.push(`Invalid arrow points: ${element.id}`); for (const binding of [element.startBinding, element.endBinding]) if (binding && !byId.has((binding as {elementId:string}).elementId)) errors.push(`Missing arrow binding: ${element.id}`); }
    if ("label" in element) errors.push(`Unsupported shape label: ${element.id}`);
    if (!["#1e1e1e", "#ffffff", "#1971c2", "#2b8a3e", "#e67700", "#7048e8", "#c92a2a", "#0b7285", "#5f3dc4", "transparent", "#d0ebff", "#d3f9d8", "#fff3bf", "#e5dbff", "#ffe3e3", "#e3fafc", "#ede7f6"].includes(String(element.strokeColor)) || !["transparent", "#d0ebff", "#d3f9d8", "#fff3bf", "#e5dbff", "#ffe3e3", "#e3fafc", "#ede7f6", "#ffffff", "#121212"].includes(String(element.backgroundColor))) errors.push(`Invalid color: ${element.id}`);
  }
  const text = document.elements.filter(element => element.type === "text").map(element => String(element.text)).join("\n").normalize("NFC");
  for (const term of protectedTerms) if (!text.includes(term.normalize("NFC"))) errors.push(`Protected term missing from document: ${term}`);
  if (document.elements.length > 650) errors.push("Element limit exceeded");
  return { valid: errors.length === 0, errors, warnings };
}
