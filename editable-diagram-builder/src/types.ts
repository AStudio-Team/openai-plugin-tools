export const DIAGRAM_TYPES = ["flowchart", "architecture", "sequence", "concept-map"] as const;
export const DIRECTIONS = ["auto", "left-right", "top-bottom"] as const;
export const COLOR_ROLES = ["primary", "success", "warning", "processing", "critical", "note", "storage"] as const;
export type DiagramType = typeof DIAGRAM_TYPES[number];
export type Direction = typeof DIRECTIONS[number];
export type ColorRole = typeof COLOR_ROLES[number];

export interface DiagramBrief {
  schemaVersion: "1.0";
  diagramType: DiagramType;
  title: string;
  purpose: string;
  audience: string;
  direction: Direction;
  detailLevel: "concise" | "standard" | "detailed";
  theme: "auto" | "light" | "dark";
  requiredItems: string[];
  requiredRelationships: string[];
  protectedTerms: string[];
  constraints: string[];
  assumptions: string[];
}

export interface SceneNode {
  id: string;
  label: string;
  detail?: string;
  kind: "start" | "process" | "decision" | "system" | "service" | "database" | "external" | "actor" | "concept" | "note";
  groupId?: string;
  order: number;
  colorRole: ColorRole;
  protected?: boolean;
  position?: { x: number; y: number };
}
export interface SceneEdge { id: string; from: string; to: string; label?: string; order: number; direction: "forward" | "both" | "none"; lineStyle: "solid" | "dashed" | "dotted"; }
export interface SceneGroup { id: string; label: string; order: number; colorRole: "primary" | "processing" | "storage"; }
export interface DiagramScene { schemaVersion: "1.0"; briefDigest: string; title: string; diagramType: DiagramType; nodes: SceneNode[]; edges: SceneEdge[]; groups: SceneGroup[]; notes: string[]; }
export interface DiagramEdit { op: "move-node" | "set-label" | "set-edge-label" | "set-color-role" | "set-line-style" | "set-direction"; targetId: string; value: unknown; }
export interface ExcalidrawElement { [key: string]: unknown; id: string; type: string; x: number; y: number; width: number; height: number; }
export interface ExcalidrawDocument { type: "excalidraw"; version: 2; source: "editable-diagram-builder"; elements: ExcalidrawElement[]; appState: { viewBackgroundColor: string }; files: Record<string, never>; }
export interface CompiledVariant { variantId: "compact" | "balanced" | "spacious"; name: string; description: string; width: number; height: number; svg: string; document?: ExcalidrawDocument; validation: { valid: boolean; warnings: string[]; errors: string[] }; }
