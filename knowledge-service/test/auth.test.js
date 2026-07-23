import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "../src/server.js";

test("isAuthorized allows any request when no key is configured", () => {
  assert.equal(isAuthorized({ headers: {} }, ""), true);
});

test("isAuthorized rejects a missing header when a key is configured", () => {
  assert.equal(isAuthorized({ headers: {} }, "secret"), false);
});

test("isAuthorized rejects a wrong key", () => {
  assert.equal(isAuthorized({ headers: { "x-knowledge-key": "wrong" } }, "secret"), false);
});

test("isAuthorized accepts a matching key", () => {
  assert.equal(isAuthorized({ headers: { "x-knowledge-key": "secret" } }, "secret"), true);
});

test("isAuthorized rejects a key of different length without throwing", () => {
  assert.equal(
    isAuthorized({ headers: { "x-knowledge-key": "short" } }, "a-much-longer-secret-key"),
    false
  );
});
