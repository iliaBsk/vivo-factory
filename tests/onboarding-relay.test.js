import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOnboardingRelay } from "../src/onboarding-relay.js";

test("startJob creates a job; duplicate startJob is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.startJob("j1");
  relay.startJob("j1"); // no-op, must not throw
  relay.cancelJob("j1");
});

test("postEvent on unknown job is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.postEvent("missing", { type: "progress", label: "x" }); // must not throw
});

test("cancelJob on unknown job is a no-op", () => {
  const relay = createOnboardingRelay();
  relay.cancelJob("missing"); // must not throw
});

test("postEvent fans event to streamSSE listener", (t, done) => {
  const relay = createOnboardingRelay();
  relay.startJob("j2");

  const received = [];
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: () => {},
    write: (chunk) => { received.push(chunk); },
    end: () => {}
  });

  relay.streamSSE("j2", fakeRes);
  relay.postEvent("j2", { type: "progress", label: "step 1" });

  setImmediate(() => {
    assert.ok(received.some(c => c.includes('"step 1"')), "event chunk not found");
    relay.cancelJob("j2");
    done();
  });
});

test("complete fans complete event then ends SSE", (t, done) => {
  const relay = createOnboardingRelay();
  relay.startJob("j3");

  const chunks = [];
  let ended = false;
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: () => {},
    write: (chunk) => { chunks.push(chunk); },
    end: () => { ended = true; }
  });

  relay.streamSSE("j3", fakeRes);
  relay.complete("j3", { biographical: { name: { value: "Test" } } });

  setImmediate(() => {
    assert.ok(chunks.some(c => c.includes('"complete"')), "complete event missing");
    assert.ok(ended, "response not ended");
    done();
  });
});

test("streamSSE returns 404 for unknown job", () => {
  const relay = createOnboardingRelay();
  let statusCode = 0;
  let body = "";
  const fakeRes = Object.assign(new EventEmitter(), {
    writeHead: (code) => { statusCode = code; },
    end: (b) => { body = b ?? ""; }
  });

  relay.streamSSE("no-such-job", fakeRes);
  assert.equal(statusCode, 404);
  assert.ok(body.includes("not found"));
});
