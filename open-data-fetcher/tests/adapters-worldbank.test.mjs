import test from "node:test";
import assert from "node:assert/strict";
import { searchSource, resetWorldBankIndicatorCacheForTests } from "../src/adapters.mjs";

const lookup = async () => [{ address: "8.8.8.8", family: 4 }];

function pagePayload(pageNumber, pages, items) {
  return [{ page: pageNumber, pages, per_page: 1000, total: pages * 1000 }, items];
}

function makeFetchImpl(callCounts) {
  return async url => {
    const value = String(url);
    const match = /[?&]page=(\d+)/.exec(value);
    const pageNumber = Number(match[1]);
    callCounts.push(pageNumber);
    if (pageNumber === 1) return new Response(JSON.stringify(pagePayload(1, 3, [{ id: "NY.GDP.MKTP.CD", name: "GDP (current US$)", source: { value: "World Bank" }, sourceNote: "GDP note" }])), { headers: { "content-type": "application/json" } });
    if (pageNumber === 2) throw new Error("UPSTREAM_ERROR");
    if (pageNumber === 3) return new Response(JSON.stringify(pagePayload(3, 3, [{ id: "ST.INT.ARVL", name: "International tourism, number of arrivals", source: { value: "World Bank" }, sourceNote: "Tourism note" }])), { headers: { "content-type": "application/json" } });
    throw new Error(`unexpected page ${pageNumber}`);
  };
}

test("searchWorldBank finds a match on a later page, caches, and survives a failed page", async () => {
  resetWorldBankIndicatorCacheForTests();
  const callCounts = [];
  const options = { fetchImpl: makeFetchImpl(callCounts), lookup };

  const first = await searchSource("world_bank", "tourism arrivals", 1, options);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].dataset_ref, "world_bank:ST.INT.ARVL");
  assert.deepEqual([...callCounts].sort((a, b) => a - b), [1, 2, 3]);

  const callsAfterFirstSearch = callCounts.length;
  const second = await searchSource("world_bank", "gdp", 1, options);
  assert.equal(second.results.length, 1);
  assert.equal(second.results[0].dataset_ref, "world_bank:NY.GDP.MKTP.CD");
  assert.equal(callCounts.length, callsAfterFirstSearch, "second search must not refetch any indicator page");
});
