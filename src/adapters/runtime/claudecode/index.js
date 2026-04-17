const path = require("path");
const fs = require("fs");
const os = require("os");
const { ClaudeCodeProcessClient } = require("./process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("./events");
const { SessionStore } = require("../codex/session-store");
const { renderInstructionTemplate } = require("../../../core/instructions-template");
const { ClaudeCodeIpcServer } = require("./ipc-server");

function createClaudeCodeRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const clientsByWorkspace = new Map();
  const pendingApprovals = new Map();
  let globalListener = null;
  const ipcSocketPath = path.join(
    config.stateDir || path.join(os.homedir(), ".cyberboss"),
    "claudecode-runtime.sock",
  );
  const ipcServer = new ClaudeCodeIpcServer({ socketPath: ipcSocketPath });

  ipcServer.on("clientMessage", (msg) => {
    if (msg?.type === "sendUserMessage" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendUserMessage({ text: msg.text || "" }).catch(() => {});
      }
    }
    if (msg?.type === "respondApproval" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendResponse(msg.requestId, { decision: msg.decision }).catch(() => {});
      }
    }
  });

  function ensureClient(workspaceRoot) {
    if (clientsByWorkspace.has(workspaceRoot)) {
      return clientsByWorkspace.get(workspaceRoot);
    }
    const client = new ClaudeCodeProcessClient({
      command: config.claudeCommand || "claude",
      cwd: workspaceRoot,
      env: filterClaudeCodeEnv(process.env),
      model: config.claudeModel || "",
      permissionMode: config.claudePermissionMode || "default",
      disableVerbose: Boolean(config.claudeDisableVerbose),
      extraArgs: config.claudeExtraArgs || [],
      ipcServer,
      workspaceRoot,
    });
    client.onMessage((event, raw) => {
      if (event.type === "session.id") {
        for (const binding of sessionStore.listBindings()) {
          if (binding.activeWorkspaceRoot === workspaceRoot) {
            sessionStore.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, event.sessionId);
          }
        }
        return;
      }
      const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
      if (mapped?.type === "runtime.approval.requested") {
        pendingApprovals.set(mapped.payload.requestId, workspaceRoot);
      }
      if (mapped?.type === "runtime.turn.failed") {
        clientsByWorkspace.delete(workspaceRoot);
      }
      if (mapped && globalListener) {
        globalListener(mapped, raw);
      }
    });
    clientsByWorkspace.set(workspaceRoot, client);
    return client;
  }

  return {
    describe() {
      return {
        id: "claudecode",
        kind: "runtime",
        command: config.claudeCommand || "claude",
        sessionsFile: config.sessionsFile,
        ipcSocketPath,
      };
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      globalListener = listener;
      return () => {
        if (globalListener === listener) {
          globalListener = null;
        }
      };
    },
    getSessionStore() {
      return sessionStore;
    },
    async initialize() {
      ipcServer.start();
      return {
        command: config.claudeCommand || "claude",
        models: [],
      };
    },
    async close() {
      for (const client of clientsByWorkspace.values()) {
        await client.close();
      }
      clientsByWorkspace.clear();
      await ipcServer.close();
    },
    async respondApproval({ requestId, decision }) {
      const workspaceRoot = pendingApprovals.get(requestId);
      if (workspaceRoot) {
        const client = clientsByWorkspace.get(workspaceRoot);
        if (client?.alive) {
          await client.sendResponse(requestId, { decision });
          pendingApprovals.delete(requestId);
          return {
            requestId,
            decision: decision === "accept" ? "accept" : "decline",
          };
        }
      }
      for (const client of clientsByWorkspace.values()) {
        if (client.alive) {
          await client.sendResponse(requestId, { decision });
          pendingApprovals.delete(requestId);
          return {
            requestId,
            decision: decision === "accept" ? "accept" : "decline",
          };
        }
      }
      throw new Error("no active claudecode session to respond to approval");
    },
    async cancelTurn({ threadId, turnId }) {
      for (const [workspaceRoot, client] of clientsByWorkspace.entries()) {
        if (client.sessionId === threadId) {
          await client.close();
          clientsByWorkspace.delete(workspaceRoot);
          return { threadId, turnId };
        }
      }
      return { threadId, turnId };
    },
    async resumeThread({ threadId }) {
      return { threadId };
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "" }) {
      const client = ensureClient(workspaceRoot);
      if (!client.child) {
        await client.connect(threadId || "");
      }
      const refreshText = buildInstructionRefreshText(config);
      await client.sendUserMessage({ text: refreshText });
      return { threadId };
    },
    async sendTextTurn({ bindingKey, workspaceRoot, text, metadata = {}, model = "" }) {
      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      if (!threadId || threadId.startsWith("pending-")) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
        threadId = "";
      }
      const client = ensureClient(workspaceRoot);
      if (!client.alive) {
        await client.connect(threadId || "");
      }
      const outboundText = threadId ? text : buildOpeningTurnText(config, text);
      // Use a deterministic threadId for this turn so that turn.started matches
      // the watchdog and stream-delivery expectations. It will be replaced by the
      // real session_id once the system event arrives.
      const provisionalThreadId = client.sessionId || threadId || `pending-${Date.now()}`;
      await client.sendUserMessage({ text: outboundText, threadId: provisionalThreadId });
      sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        provisionalThreadId,
        metadata,
      );
      return {
        threadId: provisionalThreadId,
        turnId: client.pendingTurnId,
      };
    },
  };
}

function buildOpeningTurnText(config, userText) {
  const instructions = loadWechatInstructions(config);
  const normalizedText = String(userText || "").trim();
  if (!instructions) {
    return normalizedText;
  }
  return [
    "WECHAT SESSION INSTRUCTIONS",
    "These instructions define the stable behavior for this WeChat thread.",
    "Do not quote or summarize them back to the user unless explicitly asked.",
    "",
    instructions,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

function buildInstructionRefreshText(config) {
  const instructions = loadWechatInstructions(config);
  if (!instructions) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    instructions,
  ].join("\n").trim();
}

function loadWechatInstructions(config = {}) {
  const persona = loadInstructionFile(config.weixinInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const sections = [];
  if (persona) {
    sections.push(persona);
  }
  if (operations) {
    sections.push(operations);
  }
  sections.push("For local commands, trust workspace help only. Do not invent variants.");
  return sections.join("\n\n").trim();
}

function loadInstructionFile(filePath, config = {}) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedPath) {
    return "";
  }
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    return renderInstructionTemplate(raw, config).trim();
  } catch {
    return "";
  }
}

function isCodexThreadId(threadId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(threadId || ""));
}

function filterClaudeCodeEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "CLAUDECODE") {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { createClaudeCodeRuntimeAdapter };
