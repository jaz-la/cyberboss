const MAX_WEIXIN_CHUNK = 3800;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;

function splitUtf8(text, maxRunes) {
  const runes = Array.from(String(text || ""));
  if (!runes.length || runes.length <= maxRunes) {
    return [String(text || "")];
  }
  const chunks = [];
  while (runes.length) {
    chunks.push(runes.splice(0, maxRunes).join(""));
  }
  return chunks;
}

function compactPlainTextForWeixin(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n+/g, "\n"));
}

function stripTrailingChineseFullStop(text) {
  return String(text || "").replace(/。+$/u, "").trimEnd();
}

function chunkReplyText(text, limit = 3500) {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" ")
    );
    const cut = splitIndex > limit * 0.4 ? splitIndex + (candidate[splitIndex] === "\n" ? 0 : 1) : limit;
    const chunk = trimOuterBlankLines(remaining.slice(0, cut));
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    remaining = trimOuterBlankLines(remaining.slice(cut));
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.filter(Boolean);
}

function chunkReplyTextForWeixin(text) {
  return chunkReplyText(text, MAX_WEIXIN_CHUNK);
}

function packChunksForWeixinDelivery(chunks, maxMessages = WEIXIN_MAX_DELIVERY_MESSAGES, maxChunkChars = MAX_WEIXIN_CHUNK) {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => compactPlainTextForWeixin(chunk)).filter(Boolean)
    : [];
  if (!normalizedChunks.length || normalizedChunks.length <= maxMessages) {
    return normalizedChunks;
  }

  const packed = normalizedChunks.slice(0, Math.max(0, maxMessages - 1));
  const tailChunks = normalizedChunks.slice(Math.max(0, maxMessages - 1));
  if (!tailChunks.length) {
    return packed;
  }

  const tailText = compactPlainTextForWeixin(tailChunks.join("\n")) || "Completed.";
  if (tailText.length <= maxChunkChars) {
    packed.push(tailText);
    return packed;
  }

  const tailHardChunks = splitUtf8(tailText, maxChunkChars);
  if (tailHardChunks.length === 1) {
    packed.push(tailHardChunks[0]);
    return packed;
  }

  const preserveCount = Math.max(0, maxMessages - tailHardChunks.length);
  const preserved = normalizedChunks.slice(0, preserveCount);
  const rebundledTail = normalizedChunks.slice(preserveCount);
  const groupedTail = [];
  let current = "";
  for (const chunk of rebundledTail) {
    const joined = current ? `${current}\n${chunk}` : chunk;
    if (current && joined.length > maxChunkChars) {
      groupedTail.push(current);
      current = chunk;
      continue;
    }
    current = joined;
  }
  if (current) {
    groupedTail.push(current);
  }

  return preserved.concat(groupedTail.map((item) => compactPlainTextForWeixin(item) || "Completed.")).slice(0, maxMessages);
}

function trimOuterBlankLines(text) {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

module.exports = {
  MAX_WEIXIN_CHUNK,
  WEIXIN_MAX_DELIVERY_MESSAGES,
  chunkReplyText,
  chunkReplyTextForWeixin,
  compactPlainTextForWeixin,
  packChunksForWeixinDelivery,
  splitUtf8,
  stripTrailingChineseFullStop,
  trimOuterBlankLines,
};
