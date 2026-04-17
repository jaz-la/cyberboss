const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

test("image attachments inject view_image instructions for runtimes that support it", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-inbound-test-"));
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "image/jpeg" : "";
      },
    },
    async arrayBuffer() {
      return Buffer.from("fake-jpeg-bytes");
    },
  });

  try {
    const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({
      config: {
        stateDir,
        weixinCdnBaseUrl: "https://cdn.example.com",
        userName: "User",
        userTimezone: "Asia/Shanghai",
      },
      runtimeAdapter: {
        describe() {
          return { id: "codex" };
        },
      },
      channelAdapter: {
        async sendText() {},
      },
    }, {
      provider: "weixin",
      text: "",
      senderId: "user-1",
      contextToken: "ctx-1",
      attachments: [{
        kind: "image",
        fileName: "photo.jpg",
        directUrls: ["https://example.com/photo.jpg"],
        mediaRef: { encryptType: 0 },
      }],
      receivedAt: "2026-04-17T10:00:00.000Z",
    }, "/workspace");

    assert.match(prepared.text, /For images, use `view_image`/i);
    assert.match(prepared.text, /Do not use `Read` or shell commands on image files/i);
    assert.match(prepared.text, /strictly follow workspace help only/i);
    assert.equal(prepared.attachments[0].contentType, "image/jpeg");
    assert.equal(prepared.attachments[0].isImage, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("image attachments tell claudecode to use Read on the saved local image file", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-inbound-test-"));
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "image/jpeg" : "";
      },
    },
    async arrayBuffer() {
      return Buffer.from("fake-jpeg-bytes");
    },
  });

  try {
    const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({
      config: {
        stateDir,
        weixinCdnBaseUrl: "https://cdn.example.com",
        userName: "User",
        userTimezone: "Asia/Shanghai",
      },
      runtimeAdapter: {
        describe() {
          return { id: "claudecode" };
        },
      },
      channelAdapter: {
        async sendText() {},
      },
    }, {
      provider: "weixin",
      text: "",
      senderId: "user-1",
      contextToken: "ctx-1",
      attachments: [{
        kind: "image",
        fileName: "photo.jpg",
        directUrls: ["https://example.com/photo.jpg"],
        mediaRef: { encryptType: 0 },
      }],
      receivedAt: "2026-04-17T10:00:00.000Z",
    }, "/workspace");

    assert.match(prepared.text, /You must read these files before replying to User/i);
    assert.match(prepared.text, /For images, use `Read` on the saved local image file/i);
    assert.match(prepared.text, /Do not use shell commands or wrappers/i);
    assert.match(prepared.text, /strictly follow workspace help only/i);
    assert.doesNotMatch(prepared.text, /view_image/i);
    assert.equal(prepared.attachments[0].contentType, "image/jpeg");
    assert.equal(prepared.attachments[0].isImage, true);
  } finally {
    global.fetch = originalFetch;
  }
});
