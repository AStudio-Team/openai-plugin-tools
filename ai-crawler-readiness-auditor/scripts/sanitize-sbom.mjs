import { readFileSync, writeFileSync } from "node:fs";
const path = new URL("../sbom.cdx.json", import.meta.url);
const text = readFileSync(path, "utf8").replaceAll("\u2014", " - ");
JSON.parse(text);
writeFileSync(path, text);
