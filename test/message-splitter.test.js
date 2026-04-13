const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_WEIXIN_CHUNK,
  chunkReplyTextForWeixin,
} = require("../src/adapters/channel/weixin/message-splitter");

test("three-sentence reply with blank-line breaks is one chunk", () => {
  const text = "先别想做多少。\n\n把第一题打开，读完题面。\n\n然后只回我两个字：会 / 不会。";
  const chunks = chunkReplyTextForWeixin(text);
  assert.deepEqual(chunks, [text]);
});

test("single-line reply with multiple Chinese sentence punctuation stays one chunk", () => {
  const text = "你好。今天天气不错。我们开始吧。";
  const chunks = chunkReplyTextForWeixin(text);
  assert.deepEqual(chunks, [text]);
});

test("markdown-style list with several items stays one chunk", () => {
  const text = "步骤：\n- 打开题目\n- 读完题面\n- 回答会或不会";
  const chunks = chunkReplyTextForWeixin(text);
  assert.deepEqual(chunks, [text]);
});

test("short Latin reply with terminal punctuation stays one chunk", () => {
  const text = "Hi there! How are you? Let's go.";
  const chunks = chunkReplyTextForWeixin(text);
  assert.deepEqual(chunks, [text]);
});

test("empty text returns no chunks", () => {
  assert.deepEqual(chunkReplyTextForWeixin(""), []);
  assert.deepEqual(chunkReplyTextForWeixin("   \n\n  "), []);
});

test("text longer than MAX_WEIXIN_CHUNK is split but only at the size boundary", () => {
  const paragraph = "段落内容。".repeat(400);
  const text = `${paragraph}\n\n${paragraph}`;
  const chunks = chunkReplyTextForWeixin(text);
  assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= MAX_WEIXIN_CHUNK, `chunk too long: ${chunk.length}`);
  }
  const rejoined = chunks.join("");
  assert.ok(rejoined.length >= text.replace(/\s+/g, "").length * 0.9);
});
