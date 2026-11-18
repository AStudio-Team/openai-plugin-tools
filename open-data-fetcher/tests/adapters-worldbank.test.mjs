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

function bigIndicatorItem(index) {
  const id = `IND.${String(index).padStart(3, "0")}`;
  return { id, name: `Matching indicator ${id}`, source: { value: "World Bank" }, sourceNote: "note" };
}

function makeConcurrencyFetchImpl(state) {
  return async url => {
    const value = String(url);
    const pageNumber = Number(/[?&]page=(\d+)/.exec(value)[1]);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    state.calls.push(pageNumber);
    await new Promise(resolve => setTimeout(resolve, 5));
    state.inFlight -= 1;
    const startIndex = (pageNumber - 1) * 4 + 1;
    const items = pageNumber <= 5 ? [bigIndicatorItem(startIndex), bigIndicatorItem(startIndex + 1), bigIndicatorItem(startIndex + 2), bigIndicatorItem(startIndex + 3)] : [];
    return new Response(JSON.stringify(pagePayload(pageNumber, 5, items)), { headers: { "content-type": "application/json" } });
  };
}

test("concurrent searches share one load, stay within the 4-request batch and fetch each page once", async () => {
  resetWorldBankIndicatorCacheForTests();
  const state = { calls: [], inFlight: 0, maxInFlight: 0 };
  const options = { fetchImpl: makeConcurrencyFetchImpl(state), lookup };

  const [first, second] = await Promise.all([
    searchSource("world_bank", "matching indicator", 1, options),
    searchSource("world_bank", "matching indicator", 1, options),
  ]);

  assert.ok(state.maxInFlight <= 4, `concurrency exceeded 4: ${state.maxInFlight}`);
  assert.deepEqual([...state.calls].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(first.results.length, 20);
  assert.deepEqual(first.results.map(result => result.dataset_ref), second.results.map(result => result.dataset_ref));
});

function makeWidePagesFetchImpl() {
  return async url => {
    const value = String(url);
    const pageNumber = Number(/[?&]page=(\d+)/.exec(value)[1]);
    const startIndex = (pageNumber - 1) * 4 + 1;
    const items = pageNumber <= 10 ? [bigIndicatorItem(startIndex), bigIndicatorItem(startIndex + 1), bigIndicatorItem(startIndex + 2), bigIndicatorItem(startIndex + 3)] : [];
    return new Response(JSON.stringify(pagePayload(pageNumber, 10, items)), { headers: { "content-type": "application/json" } });
  };
}

test("page 2 returns the next twenty matches, sorted, distinct from page 1", async () => {
  resetWorldBankIndicatorCacheForTests();
  const options = { fetchImpl: makeWidePagesFetchImpl(), lookup };

  const pageOne = await searchSource("world_bank", "matching indicator", 1, options);
  const pageTwo = await searchSource("world_bank", "matching indicator", 2, options);

  assert.equal(pageOne.page, 1);
  assert.equal(pageTwo.page, 2);
  assert.equal(pageOne.results.length, 20);
  assert.equal(pageOne.has_more, true);
  assert.equal(pageTwo.results.length, 20);
  assert.equal(pageTwo.has_more, false);
  const overlap = pageOne.results.filter(result => pageTwo.results.some(other => other.dataset_ref === result.dataset_ref));
  assert.equal(overlap.length, 0);
});

test("cache is reused before 24 hours and refetched after", async () => {
  resetWorldBankIndicatorCacheForTests();
  const state = { calls: [], inFlight: 0, maxInFlight: 0 };
  let currentTime = 1000;
  const options = { fetchImpl: makeConcurrencyFetchImpl(state), lookup, now: () => currentTime };

  await searchSource("world_bank", "matching indicator", 1, options);
  const callsAfterFirst = state.calls.length;

  currentTime += 24 * 60 * 60 * 1000 - 1000;
  await searchSource("world_bank", "matching indicator", 1, options);
  assert.equal(state.calls.length, callsAfterFirst, "still within 24h ttl, no refetch expected");

  currentTime += 2000;
  await searchSource("world_bank", "matching indicator", 1, options);
  assert.ok(state.calls.length > callsAfterFirst, "past 24h ttl, expected a refetch");
});

test("a partial load (page failure) is cached for only 5 minutes", async () => {
  resetWorldBankIndicatorCacheForTests();
  let page2Attempts = 0;
  let currentTime = 1000;
  const fetchImpl = async url => {
    const value = String(url);
    const pageNumber = Number(/[?&]page=(\d+)/.exec(value)[1]);
    if (pageNumber === 2) { page2Attempts += 1; throw new Error("UPSTREAM_ERROR"); }
    const startIndex = (pageNumber - 1) * 4 + 1;
    const items = pageNumber <= 3 ? [bigIndicatorItem(startIndex), bigIndicatorItem(startIndex + 1), bigIndicatorItem(startIndex + 2), bigIndicatorItem(startIndex + 3)] : [];
    return new Response(JSON.stringify(pagePayload(pageNumber, 3, items)), { headers: { "content-type": "application/json" } });
  };
  const options = { fetchImpl, lookup, now: () => currentTime };

  const first = await searchSource("world_bank", "matching indicator", 1, options);
  assert.ok(first.results.length > 0, "partial load still returns what did load");
  const attemptsAfterFirst = page2Attempts;

  currentTime += 5 * 60 * 1000 - 1000;
  await searchSource("world_bank", "matching indicator", 1, options);
  assert.equal(page2Attempts, attemptsAfterFirst, "still within 5 minute partial ttl, no refetch expected");

  currentTime += 2000;
  await searchSource("world_bank", "matching indicator", 1, options);
  assert.ok(page2Attempts > attemptsAfterFirst, "past 5 minute partial ttl, expected a refetch");
});

test("page 1 failure fails fast, suppresses retries for 60s across concurrent waiters, then recovers", async () => {
  resetWorldBankIndicatorCacheForTests();
  let page1Attempts = 0;
  let currentTime = 1000;
  const fetchImpl = async url => {
    const value = String(url);
    const pageNumber = Number(/[?&]page=(\d+)/.exec(value)[1]);
    if (pageNumber === 1) {
      page1Attempts += 1;
      if (page1Attempts === 1) throw new Error("UPSTREAM_ERROR");
      return new Response(JSON.stringify(pagePayload(1, 1, [bigIndicatorItem(1)])), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected page ${pageNumber}`);
  };
  const options = { fetchImpl, lookup, now: () => currentTime };

  const [firstA, firstB] = await Promise.allSettled([
    searchSource("world_bank", "matching indicator", 1, options),
    searchSource("world_bank", "matching indicator", 1, options),
  ]);
  assert.equal(firstA.status, "rejected");
  assert.equal(firstB.status, "rejected");
  assert.equal(page1Attempts, 1, "concurrent waiters share the single page 1 fetch and both reject");

  currentTime += 60 * 1000 - 1000;
  const third = await searchSource("world_bank", "matching indicator", 1, options).then(() => null, error => error);
  assert.ok(third instanceof Error);
  assert.equal(page1Attempts, 1, "still within the 60s suppression window, no refetch");

  currentTime += 2000;
  const result = await searchSource("world_bank", "matching indicator", 1, options);
  assert.equal(page1Attempts, 2, "past the 60s window, a retry is attempted");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].dataset_ref, "world_bank:IND.001");
});

test("results keep World Bank response order (page order, then order within page), never sorted by ID", async () => {
  resetWorldBankIndicatorCacheForTests();
  const fetchImpl = async url => {
    const value = String(url);
    const pageNumber = Number(/[?&]page=(\d+)/.exec(value)[1]);
    if (pageNumber === 1) {
      return new Response(JSON.stringify(pagePayload(1, 1, [
        { id: "ZZZ.MATCH.3", name: "Matching indicator third", source: { value: "World Bank" }, sourceNote: "n" },
        { id: "AAA.MATCH.1", name: "Matching indicator first", source: { value: "World Bank" }, sourceNote: "n" },
        { id: "MMM.MATCH.2", name: "Matching indicator second", source: { value: "World Bank" }, sourceNote: "n" },
      ])), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected page ${pageNumber}`);
  };
  const options = { fetchImpl, lookup };

  const result = await searchSource("world_bank", "matching indicator", 1, options);
  assert.deepEqual(result.results.map(item => item.dataset_ref), [
    "world_bank:ZZZ.MATCH.3", "world_bank:AAA.MATCH.1", "world_bank:MMM.MATCH.2",
  ]);
});
