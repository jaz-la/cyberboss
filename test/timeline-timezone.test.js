const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ensureTimelineTimezone } = require("../src/integrations/timeline");

function createTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-timeline-tz-"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("ensureTimelineTimezone seeds taxonomy with the user timezone on a fresh install", () => {
  const stateDir = createTempStateDir();

  ensureTimelineTimezone(stateDir, "America/Los_Angeles");

  const taxonomyPath = path.join(stateDir, "timeline", "timeline-taxonomy.json");
  const seeded = readJson(taxonomyPath);
  assert.equal(seeded.timezone, "America/Los_Angeles");
  assert.equal(seeded.version, 1);
});

test("ensureTimelineTimezone patches an existing state file without dropping other fields", () => {
  const stateDir = createTempStateDir();
  const timelineDir = path.join(stateDir, "timeline");
  fs.mkdirSync(timelineDir, { recursive: true });
  const stateFilePath = path.join(timelineDir, "timeline-state.json");
  fs.writeFileSync(
    stateFilePath,
    JSON.stringify({
      version: 1,
      timezone: "Asia/Shanghai",
      taxonomy: { categories: ["placeholder"], eventNodes: [] },
      facts: { "2026-04-12": { events: [] } },
      proposals: [{ id: "proposal-1" }],
    })
  );

  ensureTimelineTimezone(stateDir, "America/Los_Angeles");

  const patched = readJson(stateFilePath);
  assert.equal(patched.timezone, "America/Los_Angeles");
  assert.deepEqual(patched.taxonomy, { categories: ["placeholder"], eventNodes: [] });
  assert.deepEqual(patched.facts, { "2026-04-12": { events: [] } });
  assert.deepEqual(patched.proposals, [{ id: "proposal-1" }]);
});

test("ensureTimelineTimezone patches taxonomy and facts when no combined state exists", () => {
  const stateDir = createTempStateDir();
  const timelineDir = path.join(stateDir, "timeline");
  fs.mkdirSync(timelineDir, { recursive: true });
  const taxonomyPath = path.join(timelineDir, "timeline-taxonomy.json");
  const factsPath = path.join(timelineDir, "timeline-facts.json");
  fs.writeFileSync(taxonomyPath, JSON.stringify({ version: 1, timezone: "Asia/Shanghai", taxonomy: {} }));
  fs.writeFileSync(factsPath, JSON.stringify({ version: 1, timezone: "Asia/Shanghai", facts: {}, proposals: [] }));

  ensureTimelineTimezone(stateDir, "America/Los_Angeles");

  assert.equal(readJson(taxonomyPath).timezone, "America/Los_Angeles");
  assert.equal(readJson(factsPath).timezone, "America/Los_Angeles");
});

test("ensureTimelineTimezone does nothing when the timezone is already correct", () => {
  const stateDir = createTempStateDir();
  const timelineDir = path.join(stateDir, "timeline");
  fs.mkdirSync(timelineDir, { recursive: true });
  const taxonomyPath = path.join(timelineDir, "timeline-taxonomy.json");
  const initialBody = JSON.stringify({ version: 1, timezone: "America/Los_Angeles", taxonomy: {} });
  fs.writeFileSync(taxonomyPath, initialBody);
  const { mtimeMs: initialMtime } = fs.statSync(taxonomyPath);

  ensureTimelineTimezone(stateDir, "America/Los_Angeles");

  assert.equal(fs.readFileSync(taxonomyPath, "utf8"), initialBody);
  assert.equal(fs.statSync(taxonomyPath).mtimeMs, initialMtime);
});

test("ensureTimelineTimezone is a no-op when no timezone is provided", () => {
  const stateDir = createTempStateDir();

  ensureTimelineTimezone(stateDir, "");

  const timelineDir = path.join(stateDir, "timeline");
  assert.equal(fs.existsSync(timelineDir), false);
});
