const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");

const DEFERRED_REPLY_NOTICE = "由于微信 context_token 的限制，上轮对话里有一部分内容当时没能送达；这次用户再次发来消息、context_token 刷新后，先把遗留内容补上。如果这种情况反复出现，可发送 /chunk <数字>（例如 /chunk 50）调大最小合并字符数，减少消息分片。";
const DEFERRED_PLAIN_REPLY_HEADER = "===== 上轮对话遗留内容 =====";
const DEFERRED_SYSTEM_REPLY_HEADER = "===== 期间模型主动联系 =====";

function createAppLike({ pendingReplies = [] } = {}) {
  const drained = [];
  const primedPrefixes = [];
  const appLike = {
    deferredSystemReplyQueue: {
      drainForSender(accountId, senderId) {
        drained.push({ accountId, senderId });
        return pendingReplies;
      },
    },
    streamDelivery: {
      setDeferredReplyPrefix(bindingKey, text) {
        primedPrefixes.push({ bindingKey, text });
      },
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          buildBindingKey({ workspaceId, accountId, senderId }) {
            return `binding:${accountId}:${senderId}:${workspaceId}`;
          },
        };
      },
    },
  };
  return { appLike, drained, primedPrefixes };
}

test("incoming message with fresh context token primes a system deferred reply as prefix", () => {
  const { appLike, drained, primedPrefixes } = createAppLike({
    pendingReplies: [
      {
        id: "deferred-1",
        accountId: "acc-1",
        senderId: "user-1",
        threadId: "thread-1",
        kind: "system_reply",
        text: "刚才那条现在补给你",
        createdAt: new Date().toISOString(),
      },
    ],
  });

  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "acc-1",
    senderId: "user-1",
    workspaceId: "ws-1",
    contextToken: "ctx-fresh",
  });

  assert.deepEqual(drained, [{ accountId: "acc-1", senderId: "user-1" }]);
  assert.equal(primedPrefixes.length, 1);
  assert.equal(primedPrefixes[0].bindingKey, "binding:acc-1:user-1:ws-1");
  assert.equal(
    primedPrefixes[0].text,
    `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n刚才那条现在补给你`
  );
});

test("incoming message primes mixed plain and system deferred replies into grouped prefix", () => {
  const { appLike, primedPrefixes } = createAppLike({
    pendingReplies: [
      {
        id: "deferred-plain",
        accountId: "acc-2",
        senderId: "user-2",
        threadId: "thread-2a",
        kind: "plain_reply",
        text: "上轮尾段",
        createdAt: new Date().toISOString(),
      },
      {
        id: "deferred-system",
        accountId: "acc-2",
        senderId: "user-2",
        threadId: "thread-2b",
        kind: "system_reply",
        text: "中间主动联系",
        createdAt: new Date().toISOString(),
      },
    ],
  });

  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "acc-2",
    senderId: "user-2",
    workspaceId: "ws-2",
    contextToken: "ctx-fresh-2",
  });

  assert.equal(primedPrefixes.length, 1);
  assert.equal(
    primedPrefixes[0].text,
    `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_PLAIN_REPLY_HEADER}\n上轮尾段\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n中间主动联系`
  );
});

test("incoming message without pending deferred replies does not prime a prefix", () => {
  const { appLike, drained, primedPrefixes } = createAppLike({ pendingReplies: [] });

  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "acc-3",
    senderId: "user-3",
    workspaceId: "ws-3",
    contextToken: "ctx-fresh-3",
  });

  assert.deepEqual(drained, [{ accountId: "acc-3", senderId: "user-3" }]);
  assert.equal(primedPrefixes.length, 0);
});

test("missing identifiers skip draining the deferred system reply queue", () => {
  const { appLike, drained, primedPrefixes } = createAppLike({ pendingReplies: [] });

  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "",
    senderId: "user-4",
    workspaceId: "ws-4",
    contextToken: "ctx-4",
  });
  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "acc-5",
    senderId: "",
    workspaceId: "ws-5",
    contextToken: "ctx-5",
  });
  CyberbossApp.prototype.primeDeferredRepliesForSender.call(appLike, {
    accountId: "acc-6",
    senderId: "user-6",
    workspaceId: "ws-6",
    contextToken: "",
  });

  assert.equal(drained.length, 0);
  assert.equal(primedPrefixes.length, 0);
});
