import { createHash } from "node:crypto";
import type { ColorRole, CompiledVariant, DiagramBrief, DiagramEdit, DiagramScene, ExcalidrawDocument, ExcalidrawElement, SceneNode } from "./types.js";
import { digest } from "./canonical.js";
import { validateDocument, validateScene } from "./validation.js";
import { sceneSchema } from "./schemas.js";

const palette: Record<ColorRole, { stroke: string; fill: string }> = {
  primary: { stroke: "#1971c2", fill: "#d0ebff" }, success: { stroke: "#2b8a3e", fill: "#d3f9d8" }, warning: { stroke: "#e67700", fill: "#fff3bf" }, processing: { stroke: "#7048e8", fill: "#e5dbff" }, critical: { stroke: "#c92a2a", fill: "#ffe3e3" }, note: { stroke: "#5f3dc4", fill: "#ede7f6" }, storage: { stroke: "#0b7285", fill: "#e3fafc" },
};
const specs = {
  compact: { gapX: 70, gapY: 115, pad: 45, name: "Compact", description: "Efficient canvas with close spacing" },
  balanced: { gapX: 100, gapY: 145, pad: 65, name: "Balanced", description: "Readable spacing with moderate canvas size" },
  spacious: { gapX: 140, gapY: 180, pad: 90, name: "Spacious", description: "Generous spacing for detailed review" },
} as const;
type VariantId = keyof typeof specs;
type Box = { x: number; y: number; width: number; height: number };

function stableId(prefix: string, semanticId: string): string { return `${prefix}-${createHash("sha256").update(`${prefix}:${semanticId}`).digest("hex").slice(0, 16)}`; }
function seed(id: string): number { return Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16); }
function base(id: string, type: string, box: Box, stroke: string, fill: string): ExcalidrawElement {
  return { id, type, ...box, angle: 0, strokeColor: stroke, backgroundColor: fill, fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null, roundness: type === "rectangle" ? { type: 3 } : null, seed: seed(id), version: 1, versionNonce: seed(`${id}-version`), isDeleted: false, boundElements: [], updated: 1, link: null, locked: false };
}
function shapeType(node: SceneNode): "rectangle" | "ellipse" | "diamond" { return node.kind === "decision" ? "diamond" : ["start", "actor", "concept"].includes(node.kind) ? "ellipse" : "rectangle"; }
function nodeSize(node: SceneNode): { width: number; height: number } { const width = Math.max(140, Math.min(280, 80 + node.label.length * 7)); return { width, height: node.detail ? 90 : 70 }; }
function boundaryPoint(from: Box, to: Box): { x: number; y: number } {
  const cx=from.x+from.width/2,cy=from.y+from.height/2,tx=to.x+to.width/2,ty=to.y+to.height/2,dx=tx-cx,dy=ty-cy;
  if (!dx && !dy) return {x:cx,y:cy};
  const scale=1/Math.max(Math.abs(dx)/(from.width/2),Math.abs(dy)/(from.height/2));
  return {x:Math.round(cx+dx*scale),y:Math.round(cy+dy*scale)};
}

function topologicalLayers(scene: DiagramScene): Map<string, number> {
  const layer = new Map(scene.nodes.map(node => [node.id, 0]));
  for (let pass = 0; pass < scene.nodes.length; pass++) {
    let changed = false;
    for (const edge of [...scene.edges].sort((a,b) => a.order-b.order || a.id.localeCompare(b.id))) {
      const next = Math.min(scene.nodes.length - 1, (layer.get(edge.from) || 0) + 1);
      if (edge.from !== edge.to && next > (layer.get(edge.to) || 0)) { layer.set(edge.to, next); changed = true; }
    }
    if (!changed) break;
  }
  return layer;
}
function calculateBoxes(scene: DiagramScene, variant: VariantId, direction: "left-right" | "top-bottom"): Map<string, Box> {
  const spec = specs[variant]; const boxes = new Map<string, Box>(); const ordered = [...scene.nodes].sort((a,b) => a.order-b.order || a.id.localeCompare(b.id));
  if (scene.diagramType === "concept-map") {
    const center = ordered[0]!; const centerSize = nodeSize(center); const radius = Math.max(220, (180+spec.gapX) * Math.ceil((ordered.length - 1) / 6));
    boxes.set(center.id, { x: radius + spec.pad, y: radius + spec.pad, ...centerSize });
    ordered.slice(1).forEach((node,index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, ordered.length - 1); const size = nodeSize(node); boxes.set(node.id, { x: Math.round(radius + spec.pad + Math.cos(angle)*radius), y: Math.round(radius + spec.pad + Math.sin(angle)*radius), ...size }); });
  } else if (scene.diagramType === "sequence") {
    ordered.forEach((node,index) => { const size = nodeSize(node); boxes.set(node.id, { x: spec.pad + index * (280+spec.gapX), y: spec.pad + 70, ...size }); });
  } else {
    const layers = topologicalLayers(scene); const groups = new Map<number, SceneNode[]>();
    for (const node of ordered) { const n = layers.get(node.id) || 0; groups.set(n, [...(groups.get(n) || []), node]); }
    const groupRank = new Map([...scene.groups].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)).map((group,index)=>[group.id,index]));
    const band = spec.gapY * 2;
    for (const [layer, nodes] of [...groups].sort(([a],[b]) => a-b)) {
      const seen = new Map<string,number>();
      nodes.forEach((node,index) => {
        const size=nodeSize(node),a=spec.pad+layer*(280+spec.gapX),key=node.groupId||"ungrouped",within=seen.get(key)||0,rank=groupRank.get(key)??(scene.groups.length+index);
        seen.set(key,within+1);
        const b=spec.pad+rank*band+within*spec.gapY;
        boxes.set(node.id,direction==="left-right"?{x:a,y:b+70,...size}:{x:b,y:a+70,...size});
      });
    }
  }
  for (const node of ordered) if (node.position) { const current = boxes.get(node.id)!; boxes.set(node.id, { ...current, x: node.position.x, y: node.position.y }); }
  return boxes;
}
function addText(elements: ExcalidrawElement[], semanticId: string, text: string, box: Box, containerId: string | null, fontSize: number, color: string): string {
  const id = stableId("text", semanticId); const height = Math.max(24, Math.ceil(text.length / Math.max(12, Math.floor(box.width / (fontSize * .58)))) * (fontSize + 5));
  const element = { ...base(id, "text", { x: box.x, y: box.y + Math.max(0,(box.height-height)/2), width: box.width, height }, color, "transparent"), text, fontSize, fontFamily: 1, textAlign: "center", verticalAlign: "middle", containerId, originalText: text, autoResize: true, lineHeight: 1.25 };
  elements.push(element); return id;
}
function escapeXml(value: string): string { return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]!)); }
function renderSvg(document: ExcalidrawDocument, width: number, height: number, semanticByShape: Map<string,string>): string {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Editable diagram preview">`,`<rect width="100%" height="100%" fill="${document.appState.viewBackgroundColor}"/>`,`<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#1e1e1e"/></marker></defs>`];
  for (const element of document.elements) {
    if (element.type === "arrow") { const points = element.points as number[][]; const end = points[points.length-1]!; parts.push(`<line x1="${element.x}" y1="${element.y}" x2="${element.x+end[0]!}" y2="${element.y+end[1]!}" stroke="${element.strokeColor}" stroke-width="2" ${element.strokeStyle === "dashed" ? 'stroke-dasharray="8 6"' : element.strokeStyle === "dotted" ? 'stroke-dasharray="2 5"' : ""} ${element.endArrowhead ? 'marker-end="url(#arrow)"' : ""}/>`); }
    else if (element.type === "text") { const container=document.elements.find(item=>item.id===element.containerId); if(container?.type==="arrow")parts.push(`<rect x="${element.x-4}" y="${element.y}" width="${element.width+8}" height="${element.height}" rx="5" fill="${document.appState.viewBackgroundColor}" opacity="0.94"/>`); parts.push(`<text x="${element.x+element.width/2}" y="${element.y+element.height/2}" fill="${element.strokeColor}" font-family="Arial,sans-serif" font-size="${element.fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(String(element.text))}</text>`); }
    else if (element.type === "ellipse") parts.push(`<ellipse data-node-id="${semanticByShape.get(element.id) || ""}" cx="${element.x+element.width/2}" cy="${element.y+element.height/2}" rx="${element.width/2}" ry="${element.height/2}" fill="${element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="2"/>`);
    else if (element.type === "diamond") parts.push(`<polygon data-node-id="${semanticByShape.get(element.id) || ""}" points="${element.x+element.width/2},${element.y} ${element.x+element.width},${element.y+element.height/2} ${element.x+element.width/2},${element.y+element.height} ${element.x},${element.y+element.height/2}" fill="${element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="2"/>`);
    else parts.push(`<rect data-node-id="${semanticByShape.get(element.id) || ""}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="10" fill="${element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="2"/>`);
  }
  return `${parts.join("")} </svg>`;
}

export function compileVariant(scene: DiagramScene, brief: DiagramBrief, variant: VariantId): CompiledVariant {
  validateScene(scene, brief);
  const direction = brief.direction === "top-bottom" ? "top-bottom" : "left-right";
  const boxes = calculateBoxes(scene, variant, direction);
  const elements: ExcalidrawElement[] = [];
  const groupLabels: Array<{id:string;label:string;box:Box;color:string}> = [];
  for (const group of [...scene.groups].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))) {
    const members = scene.nodes.filter(node => node.groupId === group.id).map(node => boxes.get(node.id)!);
    if (!members.length) continue;
    const minX=Math.min(...members.map(b=>b.x))-25, minY=Math.min(...members.map(b=>b.y))-35, maxX=Math.max(...members.map(b=>b.x+b.width))+25, maxY=Math.max(...members.map(b=>b.y+b.height))+25;
    const colors=palette[group.colorRole],groupId=stableId("group",group.id);
    elements.push({...base(groupId,"rectangle",{x:minX,y:minY,width:maxX-minX,height:maxY-minY},colors.stroke,"transparent"),strokeStyle:"dashed",strokeWidth:1});
    groupLabels.push({id:group.id,label:group.label,box:{x:minX+10,y:minY+5,width:Math.min(180,maxX-minX-20),height:24},color:colors.stroke});
  }
  if (scene.diagramType === "sequence") {
    const messageBottom = 200 + Math.max(1,scene.edges.length) * 72;
    for (const node of scene.nodes) {
      const box=boxes.get(node.id)!,id=stableId("lifeline",node.id);
      elements.push({...base(id,"rectangle",{x:box.x+box.width/2,y:box.y+box.height,width:2,height:messageBottom-box.y-box.height},"#1e1e1e","transparent"),strokeStyle:"dashed",strokeWidth:1});
    }
  }
  for (const group of groupLabels) addText(elements,`group-label-${group.id}`,group.label,group.box,null,14,group.color);
  const titleId = stableId("title", scene.title);
  addText(elements, `title-${titleId}`, scene.title, {x:40,y:15,width:900,height:40}, null, 24, "#1e1e1e");
  const shapeByNode = new Map<string,string>();
  for (const node of [...scene.nodes].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))) {
    const box=boxes.get(node.id)!,id=stableId("shape",node.id),colors=palette[node.colorRole],shape=base(id,shapeType(node),box,colors.stroke,colors.fill);
    shapeByNode.set(node.id,id); elements.push(shape);
    const textId=addText(elements,`node-${node.id}`,node.detail?`${node.label}\n${node.detail}`:node.label,{x:box.x+10,y:box.y,width:box.width-20,height:box.height},id,16,"#1e1e1e");
    shape.boundElements=[{id:textId,type:"text"}];
  }
  for (const edge of [...scene.edges].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))) {
    const from=boxes.get(edge.from)!,to=boxes.get(edge.to)!;
    const sequenceY=200+edge.order*72,start=boundaryPoint(from,to),end=boundaryPoint(to,from),sx=scene.diagramType==="sequence"?from.x+from.width/2:start.x,sy=scene.diagramType==="sequence"?sequenceY:start.y,ex=scene.diagramType==="sequence"?to.x+to.width/2:end.x,ey=scene.diagramType==="sequence"?sequenceY:end.y,id=stableId("arrow",edge.id);
    const arrow: ExcalidrawElement={...base(id,"arrow",{x:sx,y:sy,width:Math.abs(ex-sx),height:Math.abs(ey-sy)},"#1e1e1e","transparent"),points:[[0,0],[Math.round(ex-sx),Math.round(ey-sy)]],lastCommittedPoint:null,startBinding:{elementId:shapeByNode.get(edge.from),focus:0,gap:4},endBinding:{elementId:shapeByNode.get(edge.to),focus:0,gap:4},startArrowhead:edge.direction==="both"?"arrow":null,endArrowhead:edge.direction==="none"?null:"arrow",strokeStyle:edge.lineStyle,boundElements:[]};
    elements.push(arrow);
    if(edge.label){const labelId=addText(elements,`edge-${edge.id}`,edge.label,{x:(sx+ex)/2-70,y:(sy+ey)/2-18,width:140,height:36},id,14,"#1e1e1e");arrow.boundElements=[{id:labelId,type:"text"}]}
  }
  const maxX=Math.max(1000,...elements.map(e=>e.x+e.width))+60,maxY=Math.max(500,...elements.map(e=>e.y+e.height))+60;
  const document: ExcalidrawDocument={type:"excalidraw",version:2,source:"editable-diagram-builder",elements,appState:{viewBackgroundColor:brief.theme==="dark"?"#121212":"#ffffff"},files:{}};
  const validation=validateDocument(document,brief.protectedTerms),semanticByShape=new Map([...shapeByNode].map(([semantic,shape])=>[shape,semantic]));
  return {variantId:variant,name:specs[variant].name,description:specs[variant].description,width:Math.round(maxX),height:Math.round(maxY),svg:renderSvg(document,Math.round(maxX),Math.round(maxY),semanticByShape),document,validation};
}
export function compileVariants(scene: DiagramScene, brief: DiagramBrief, count=3): CompiledVariant[] { return (["balanced","compact","spacious"] as VariantId[]).slice(0,Math.max(1,Math.min(3,count))).map(id=>compileVariant(scene,brief,id)); }
export function applyEdits(scene: DiagramScene, edits: DiagramEdit[]): DiagramScene {
  if(edits.length>50) throw new Error("Maximum 50 edits per call"); const next=structuredClone(scene);
  for(const edit of edits){ const node=next.nodes.find(item=>item.id===edit.targetId); const edge=next.edges.find(item=>item.id===edit.targetId);
    if(edit.op==="move-node"){ if(!node||!edit.value||typeof edit.value!=="object") throw new Error(`Unknown node: ${edit.targetId}`); const {x,y}=edit.value as {x:unknown;y:unknown}; if(!Number.isInteger(x)||!Number.isInteger(y)||Math.abs(x as number)>10000||Math.abs(y as number)>10000) throw new Error("Move positions must be finite integers inside canvas limits"); node.position={x:x as number,y:y as number}; }
    else if(edit.op==="set-label"){ if(!node||typeof edit.value!=="string") throw new Error(`Invalid node label edit: ${edit.targetId}`); if(node.protected) throw new Error(`Protected node cannot be renamed: ${edit.targetId}`); node.label=edit.value; }
    else if(edit.op==="set-edge-label"){ if(!edge||typeof edit.value!=="string") throw new Error(`Invalid edge label edit: ${edit.targetId}`); edge.label=edit.value; }
    else if(edit.op==="set-color-role"){ if(!node||!Object.hasOwn(palette,String(edit.value))) throw new Error(`Invalid color edit: ${edit.targetId}`); node.colorRole=edit.value as ColorRole; }
    else if(edit.op==="set-line-style"){ if(!edge||!["solid","dashed","dotted"].includes(String(edit.value))) throw new Error(`Invalid line style edit: ${edit.targetId}`); edge.lineStyle=edit.value as "solid"|"dashed"|"dotted"; }
    else if(edit.op==="set-direction"){ if(!edge||!["forward","both","none"].includes(String(edit.value))) throw new Error(`Invalid direction edit: ${edit.targetId}`); edge.direction=edit.value as "forward"|"both"|"none"; }
  }
  return sceneSchema.parse(next) as DiagramScene;
}
export function sceneDigest(scene: DiagramScene): string { return digest(scene); }
