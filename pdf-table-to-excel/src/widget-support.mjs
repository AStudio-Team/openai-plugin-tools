import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bundleSource = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
const browserBundle = bundleSource.replace(/export\{([^}]+)\};?\s*$/, (_match, body) => {
  const exports = body.split(",").map(part => {
    const [local, exported] = part.split(" as ").map(value => value.trim());
    return `${exported || local}:${local}`;
  });
  return `globalThis.ExtApps={${exports.join(",")}};`;
});

if (browserBundle === bundleSource || !browserBundle.includes("globalThis.ExtApps=")) {
  throw new Error("Could not inline the MCP Apps browser bundle.");
}

export function loadWidget(relativePath) {
  const template = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  if (!template.includes("/*__EXT_APPS_BUNDLE__*/")) throw new Error(`Widget bundle placeholder missing: ${relativePath}`);
  return template.replace("/*__EXT_APPS_BUNDLE__*/", () => browserBundle);
}

export const closedUiMeta = Object.freeze({
  csp: {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  },
  prefersBorder: true,
});
