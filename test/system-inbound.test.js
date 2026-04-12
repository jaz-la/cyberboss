const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");
const { SystemMessageDispatcher } = require("../src/core/system-message-dispatcher");

test("system messages bypass normal inbound wrapping", async () => {
  const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({}, {
    provider: "system",
    text: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    attachments: [],
  }, "/tmp");

  assert.deepEqual(prepared, {
    provider: "system",
    text: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    originalText: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    attachments: [],
    attachmentFailures: [],
  });
});

test("system dispatcher stamps inbound text with the configured user timezone", () => {
  const dispatcher = new SystemMessageDispatcher({
    queueStore: null,
    config: {
      workspaceId: "w",
      workspaceRoot: "/tmp",
      userTimezone: "America/Los_Angeles",
    },
    accountId: "a",
  });

  const prepared = dispatcher.buildPreparedMessage({
    senderId: "u1",
    id: "m1",
    text: "hello",
    createdAt: "2026-04-11T06:23:00.000Z",
  });

  assert.match(prepared.text, /^\[2026-04-10 23:23\]/);
});
