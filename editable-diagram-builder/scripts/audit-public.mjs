import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root=resolve(new URL("..",import.meta.url).pathname);const files=["plugin.json","mcp.json","README.md","THIRD_PARTY_NOTICES.md","skills/editable-diagram-builder/SKILL.md","widgets/brief-editor.html","widgets/diagram-preview.html","src/server.ts","src/compiler.ts"];
const forbidden=[[/\/Users\//,"local user path"],[/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,"private key"],[/\b(?:sk-|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/,"token"],[/\u2014/,"em dash"]];for(const file of files){const text=readFileSync(resolve(root,file),"utf8");for(const [pattern,label] of forbidden)if(pattern.test(text))throw new Error(`${label} found in ${file}`)}console.log(`public audit passed for ${files.length} files`);
