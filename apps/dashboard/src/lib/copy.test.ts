import assert from "node:assert/strict";
import { test } from "node:test";
import { settlementsSubtitle } from "./copy.ts";

test("all simulated: says simulated, no explorer claim", () => {
  const s = settlementsSubtitle(2, 2);
  assert.match(s, /simulated/);
  assert.doesNotMatch(s, /Links open/);
});

test("mixed rows: simulated rows are called out", () => {
  const s = settlementsSubtitle(1, 3);
  assert.match(s, /Simulated rows have no link/);
  assert.doesNotMatch(s, /Links open/);
});

test("no simulated rows: explorer copy stays", () => {
  assert.match(settlementsSubtitle(0, 4), /Links open the transaction on the explorer/);
  assert.match(settlementsSubtitle(0, 0), /Links open the transaction on the explorer/);
});
