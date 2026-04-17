const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");

function createAppLike({ pendingMessages = [], dispatchResults = [] } = {}) {
  const dispatched = [];
  const requeued = [];
  const appLike = {
    systemMessageDispatcher: {
      drainPending() {
        return pendingMessages;
      },
      requeue(message) {
        requeued.push(message);
      },
    },
    latestInboundAtBySender: new Map(),
    lastAutomatedSystemDispatchAtBySender: new Map(),
    async dispatchSystemMessage(message) {
      dispatched.push(message);
      if (dispatchResults.length) {
        return dispatchResults.shift();
      }
      return true;
    },
    shouldSkipAutomatedSystemMessage(message) {
      return CyberbossApp.prototype.shouldSkipAutomatedSystemMessage.call(this, message);
    },
    noteAutomatedSystemDispatch(message, dispatchedAtMs) {
      return CyberbossApp.prototype.noteAutomatedSystemDispatch.call(this, message, dispatchedAtMs);
    },
  };
  return { appLike, dispatched, requeued };
}

test("flushPendingSystemMessages coalesces overlapping automated triggers per sender", async () => {
  const { appLike, dispatched } = createAppLike({
    pendingMessages: [
      {
        id: "manual-1",
        accountId: "acc-1",
        senderId: "user-1",
        workspaceRoot: "/tmp",
        text: "SYSTEM ACTION MODE: internal test",
        createdAt: "2026-04-17T21:00:00.000Z",
      },
      {
        id: "auto-1",
        accountId: "acc-1",
        senderId: "user-1",
        workspaceRoot: "/tmp",
        text: "Due reminder for Jieao: first reminder",
        createdAt: "2026-04-17T21:01:00.000Z",
      },
      {
        id: "auto-2",
        accountId: "acc-1",
        senderId: "user-1",
        workspaceRoot: "/tmp",
        text: "Jieao comes to mind again.",
        createdAt: "2026-04-17T21:02:00.000Z",
      },
    ],
  });

  await CyberbossApp.prototype.flushPendingSystemMessages.call(appLike);

  assert.deepEqual(
    dispatched.map((message) => message.id),
    ["manual-1", "auto-2"]
  );
});

test("flushPendingSystemMessages skips stale automated triggers after a newer inbound user update", async () => {
  const { appLike, dispatched } = createAppLike({
    pendingMessages: [
      {
        id: "auto-1",
        accountId: "acc-2",
        senderId: "user-2",
        workspaceRoot: "/tmp",
        text: "Due reminder for Jieao: check progress",
        createdAt: "2026-04-17T21:00:00.000Z",
      },
    ],
  });
  appLike.latestInboundAtBySender.set("acc-2:user-2", Date.parse("2026-04-17T21:05:00.000Z"));

  await CyberbossApp.prototype.flushPendingSystemMessages.call(appLike);

  assert.deepEqual(dispatched, []);
});

test("flushPendingSystemMessages skips duplicate automated triggers until the user sends a newer inbound message", async () => {
  const { appLike, dispatched } = createAppLike({
    pendingMessages: [
      {
        id: "auto-1",
        accountId: "acc-3",
        senderId: "user-3",
        workspaceRoot: "/tmp",
        text: "Jieao comes to mind again.",
        createdAt: "2026-04-17T21:10:00.000Z",
      },
    ],
  });
  appLike.lastAutomatedSystemDispatchAtBySender.set("acc-3:user-3", Date.parse("2026-04-17T21:09:00.000Z"));

  await CyberbossApp.prototype.flushPendingSystemMessages.call(appLike);

  assert.deepEqual(dispatched, []);
});

test("a newer inbound user update reopens automated dispatch for the next trigger", async () => {
  const { appLike, dispatched } = createAppLike({
    pendingMessages: [
      {
        id: "auto-1",
        accountId: "acc-4",
        senderId: "user-4",
        workspaceRoot: "/tmp",
        text: "Due reminder for Jieao: check again",
        createdAt: "2026-04-17T21:10:00.000Z",
      },
    ],
  });
  appLike.lastAutomatedSystemDispatchAtBySender.set("acc-4:user-4", Date.parse("2026-04-17T21:09:00.000Z"));
  appLike.latestInboundAtBySender.set("acc-4:user-4", Date.parse("2026-04-17T21:09:30.000Z"));

  await CyberbossApp.prototype.flushPendingSystemMessages.call(appLike);

  assert.deepEqual(dispatched.map((message) => message.id), ["auto-1"]);
});
