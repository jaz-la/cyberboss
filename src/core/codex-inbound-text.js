const { formatRuntimeLocalTimestamp } = require("./user-timezone");

function buildInboundText(normalized, persisted = {}, config = {}, options = {}) {
  const text = String(normalized?.text || "").trim();
  const saved = Array.isArray(persisted?.saved) ? persisted.saved : [];
  const failed = Array.isArray(persisted?.failed) ? persisted.failed : [];
  const userName = String(config?.userName || "").trim() || "the user";
  const runtimeId = normalizeText(options?.runtimeId).toLowerCase();
  const commandGuide = normalizeText(options?.commandGuide);
  const localTime = formatRuntimeLocalTimestamp(normalized?.receivedAt, config?.userTimezone);
  const lines = [];
  if (localTime) {
    lines.push(`[${localTime}]`);
  }
  if (text) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(text);
  }

  if (saved.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(`${userName} sent image/file attachments. They were saved under the local data directory:`);
    for (const item of saved) {
      const suffix = item.sourceFileName ? ` (original name: ${item.sourceFileName})` : "";
      lines.push(`- [${item.kind}] ${item.absolutePath}${suffix}`);
    }
    lines.push(`You must read these files before replying to ${userName}.`);
    if (saved.some((item) => isImageAttachmentItem(item))) {
      if (runtimeUsesReadForImages(runtimeId)) {
        lines.push("For images, use `Read` on the saved local image file. Do not use shell commands or wrappers.");
      } else {
        lines.push("For images, use `view_image`. Do not use `Read` or shell commands on image files.");
      }
    }
    lines.push("For local commands, strictly follow workspace help only. Do not invent variants or wrappers.");
    lines.push(`If a required tool is missing, tell ${userName} exactly what is missing and that you cannot read the file yet.`);
  }

  if (failed.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Attachment intake errors:");
    for (const item of failed) {
      const label = item.sourceFileName || item.kind || "attachment";
      lines.push(`- ${label}: ${item.reason}`);
    }
  }

  if (commandGuide) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(commandGuide);
  }

  return lines.join("\n").trim();
}

function buildCodexInboundText(normalized, persisted = {}, config = {}) {
  return buildInboundText(normalized, persisted, config, {});
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function runtimeUsesReadForImages(runtimeId) {
  return runtimeId === "claudecode";
}

function isImageAttachmentItem(item) {
  return Boolean(item?.isImage) || normalizeText(item?.contentType).toLowerCase().startsWith("image/")
    || normalizeText(item?.kind).toLowerCase() === "image";
}

module.exports = {
  buildInboundText,
  buildCodexInboundText,
  runtimeUsesReadForImages,
  isImageAttachmentItem,
};
