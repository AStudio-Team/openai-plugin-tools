import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWidget, previewWidget } from "../src/widgets.mjs";

test("search widget builds and inspects in place without sendMessage on choose dataset", () => {
  const html = searchWidget("/* bundle */");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /inspect_open_dataset/);
  assert.match(html, /human_selection_confirmed:true/);
  const chooseHandler = html.slice(html.indexOf("choose.addEventListener"), html.indexOf("const card=el("));
  assert.doesNotMatch(chooseHandler, /sendMessage/);
});

test("preview widget still builds and keeps its own checkpoint flow", () => {
  const html = previewWidget("/* bundle */");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /makeFlow\(app,root,status,title\)/);
  assert.match(html, /preview_open_dataset/);
  assert.match(html, /prepare_open_data_export/);
});
