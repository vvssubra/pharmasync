import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity } from "../src/cosine.js";

test("identical vectors score 1", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test("orthogonal vectors score 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("opposite vectors score -1", () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test("mismatched lengths score 0", () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
});

test("zero vector scores 0 (no division by zero)", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("empty arrays score 0", () => {
  assert.equal(cosineSimilarity([], []), 0);
});
