import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { searchWidget, previewWidget } from "../src/widgets.mjs";

const require = createRequire(import.meta.url);

// Same bundle construction as src/server.mjs inlineBundle(), so the widget
// scripts are checked with the exact same input the server embeds.
function inlineBundle() {
  const source = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  return source.replace(/export\{([^}]+)\};?\s*$/, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(value => value.trim()); return `${exported || local}:${local}`; }).join(",")}};`);
}

function extractModuleScript(html) {
  const match = html.match(/<script type="module">([\s\S]*)<\/script>/);
  assert.ok(match, "expected a <script type=\"module\"> block");
  return match[1];
}

function assertParsesAsModule(script) {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module", "-"], {
    input: script,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

test("searchWidget script parses as a valid ES module", () => {
  const bundle = inlineBundle();
  const script = extractModuleScript(searchWidget(bundle));
  assertParsesAsModule(script);
});

test("previewWidget script parses as a valid ES module", () => {
  const bundle = inlineBundle();
  const script = extractModuleScript(previewWidget(bundle));
  assertParsesAsModule(script);
});

test("previewWidget hands the export to the host in the resource shape", () => {
  const bundle = inlineBundle();
  const script = extractModuleScript(previewWidget(bundle));
  assert.match(script, /app\.downloadFile\(\{contents:\[\{type:'resource'/);
  assert.doesNotMatch(script, /app\.downloadFile\(\{name:/);
});
