const crypto = require("crypto");
const { listWeixinAccounts } = require("./account-store");
const { resolveSelectedAccount } = require("./account-store");
const { loadPersistedContextTokens, persistContextToken } = require("./context-token-store");
const { runLoginFlow } = require("./login");
const { getConfig, getUpdates, sendMessage, sendTyping } = require("./api");
const { sendWeixinMediaFile } = require("./media-send");
const { normalizeWeixinIncomingMessage } = require("./message-utils");
const { loadSyncBuffer, saveSyncBuffer } = require("./sync-buffer-store");
const {
  MAX_WEIXIN_CHUNK,
  WEIXIN_MAX_DELIVERY_MESSAGES,
  chunkReplyTextForWeixin,
  compactPlainTextForWeixin,
  packChunksForWeixinDelivery,
  splitUtf8,
  stripTrailingChineseFullStop,
} = require("./message-splitter");

const LONG_POLL_TIMEOUT_MS = 35_000;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;

function createLegacyWeixinChannelAdapter(config) {
  let selectedAccount = null;
  let contextTokenCache = null;

  function ensureAccount() {
    if (!selectedAccount) {
      selectedAccount = resolveSelectedAccount(config);
      contextTokenCache = loadPersistedContextTokens(config, selectedAccount.accountId);
    }
    return selectedAccount;
  }

  function ensureContextTokenCache() {
    if (!contextTokenCache) {
      const account = ensureAccount();
      contextTokenCache = loadPersistedContextTokens(config, account.accountId);
    }
    return contextTokenCache;
  }

  function rememberContextToken(userId, contextToken) {
    const account = ensureAccount();
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const normalizedToken = typeof contextToken === "string" ? contextToken.trim() : "";
    if (!normalizedUserId || !normalizedToken) {
      return "";
    }
    contextTokenCache = persistContextToken(config, account.accountId, normalizedUserId, normalizedToken);
    return normalizedToken;
  }

  function resolveContextToken(userId, explicitToken = "") {
    const normalizedExplicitToken = typeof explicitToken === "string" ? explicitToken.trim() : "";
    if (normalizedExplicitToken) {
      return normalizedExplicitToken;
    }
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return "";
    }
    return ensureContextTokenCache()[normalizedUserId] || "";
  }

  return {
    describe() {
      return {
        id: "weixin",
        variant: "legacy",
        kind: "channel",
        stateDir: config.stateDir,
        baseUrl: config.weixinBaseUrl,
        accountsDir: config.accountsDir,
        syncBufferDir: config.syncBufferDir,
      };
    },
    async login() {
      await runLoginFlow(config);
    },
    printAccounts() {
      const accounts = listWeixinAccounts(config);
      if (!accounts.length) {
        console.log("No saved WeChat account found. Run `npm run login` first.");
        return;
      }
      console.log("Saved accounts:");
      for (const account of accounts) {
        console.log(`- ${account.accountId}`);
        console.log(`  userId: ${account.userId || "(unknown)"}`);
        console.log(`  baseUrl: ${account.baseUrl || config.weixinBaseUrl}`);
        console.log(`  savedAt: ${account.savedAt || "(unknown)"}`);
      }
    },
    resolveAccount() {
      return ensureAccount();
    },
    getKnownContextTokens() {
      return { ...ensureContextTokenCache() };
    },
    loadSyncBuffer() {
      const account = ensureAccount();
      return loadSyncBuffer(config, account.accountId);
    },
    saveSyncBuffer(buffer) {
      const account = ensureAccount();
      saveSyncBuffer(config, account.accountId, buffer);
    },
    rememberContextToken,
    async getUpdates({ syncBuffer = "", timeoutMs = LONG_POLL_TIMEOUT_MS } = {}) {
      const account = ensureAccount();
      const response = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: syncBuffer,
        timeoutMs,
      });
      if (typeof response?.get_updates_buf === "string" && response.get_updates_buf.trim()) {
        this.saveSyncBuffer(response.get_updates_buf.trim());
      }
      const messages = Array.isArray(response?.msgs) ? response.msgs : [];
      for (const message of messages) {
        const userId = typeof message?.from_user_id === "string" ? message.from_user_id.trim() : "";
        const contextToken = typeof message?.context_token === "string" ? message.context_token.trim() : "";
        if (userId && contextToken) {
          rememberContextToken(userId, contextToken);
        }
      }
      return response;
    },
    normalizeIncomingMessage(message) {
      const account = ensureAccount();
      return normalizeWeixinIncomingMessage(message, config, account.accountId);
    },
    async sendText({ userId, text, contextToken = "", preserveBlock = false }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`Missing context_token. Cannot reply to user ${userId}.`);
      }
      const content = String(text || "");
      const sendChunks = preserveBlock
        ? splitUtf8(compactPlainTextForWeixin(content) || "Completed.", MAX_WEIXIN_CHUNK)
        : packChunksForWeixinDelivery(
          chunkReplyTextForWeixin(content).length
            ? chunkReplyTextForWeixin(content)
            : ["Completed."],
          WEIXIN_MAX_DELIVERY_MESSAGES,
          MAX_WEIXIN_CHUNK
        );
      for (let index = 0; index < sendChunks.length; index += 1) {
        const compactChunk = stripTrailingChineseFullStop(compactPlainTextForWeixin(sendChunks[index])) || "Completed.";
        await sendMessage({
          baseUrl: account.baseUrl,
          token: account.token,
          body: {
            msg: {
              client_id: crypto.randomUUID(),
              from_user_id: "",
              to_user_id: userId,
              message_type: 2,
              message_state: 2,
              item_list: [
                {
                  type: 1,
                  text_item: { text: compactChunk },
                },
              ],
              context_token: resolvedToken,
            },
          },
        });
        if (index < sendChunks.length - 1) {
          await sleep(SEND_MESSAGE_CHUNK_INTERVAL_MS);
        }
      }
    },
    async sendTyping({ userId, status = 1, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        return;
      }
      const configResponse = await getConfig({
        baseUrl: account.baseUrl,
        token: account.token,
        ilinkUserId: userId,
        contextToken: resolvedToken,
      }).catch(() => null);
      const typingTicket = typeof configResponse?.typing_ticket === "string"
        ? configResponse.typing_ticket.trim()
        : "";
      if (!typingTicket) {
        return;
      }
      await sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: userId,
          typing_ticket: typingTicket,
          status,
        },
      });
    },
    async sendFile({ userId, filePath, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`Missing context_token. Cannot send a file to user ${userId}.`);
      }
      return sendWeixinMediaFile({
        filePath,
        to: userId,
        contextToken: resolvedToken,
        baseUrl: account.baseUrl,
        token: account.token,
        cdnBaseUrl: config.weixinCdnBaseUrl,
      });
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createLegacyWeixinChannelAdapter };
