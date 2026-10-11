import { readFileSync, writeFileSync } from "node:fs";
const path = new URL("../THIRD_PARTY_LICENSES.json", import.meta.url);
const inventory = JSON.parse(readFileSync(path, "utf8"));
for (const item of Object.values(inventory)) {
  delete item.path;
  delete item.licenseFile;
  delete item.noticeFile;
}
writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
