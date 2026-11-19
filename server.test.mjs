import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createTriageServer } from "./server.mjs";

const invalidInput = { status: "invalid_input" };
const manualReview = { status: "manual_review", topic: null, draft: null };
const simulatorDraft = "Спасибо за обращение. Уточним детали заявки.";
const ready = (topic, draft = simulatorDraft) => ({ status: "ready", topic, draft });

async function startServer(t, classifier) {
  const server = createTriageServer(classifier);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const url = `http://127.0.0.1:${server.address().port}/api/triage`;

  return async (body, status, expected) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/i);
    assert.deepEqual(await response.json(), expected);
  };
}

const request = text => JSON.stringify({ text });

test("rejects invalid requests before classification", async t => {
  const classifier = t.mock.fn();
  const post = await startServer(t, classifier);
  const malformed = [
    ["empty body", ""],
    ["whitespace body", " \t\n"],
    ["truncated JSON", '{"text":'],
  ];
  const invalidShapes = [
    ["null body", null],
    ["array body", []],
    ["string body", "hello"],
    ["number body", 42],
    ["boolean body", true],
    ["missing text", {}],
    ["null text", { text: null }],
    ["numeric text", { text: 42 }],
    ["boolean text", { text: true }],
    ["array text", { text: [] }],
    ["object text", { text: {} }],
  ];
  const blankText = [
    ["empty text", ""],
    ["spaces", "  "],
    ["tabs and newlines", "\t\n \r"],
  ];
  const cases = [
    ...malformed.map(([name, body]) => [name, Buffer.from(body)]),
    ...invalidShapes.map(([name, input]) => [name, JSON.stringify(input)]),
    ...blankText.map(([name, text]) => [name, request(text)]),
  ];

  for (const [name, body] of cases) {
    await t.test(name, () => post(body, 400, invalidInput));
  }
  assert.equal(classifier.mock.callCount(), 0);
});

test("returns the exact ready response for each supported topic", async t => {
  const post = await startServer(t);
  for (const [text, topic] of [
    ["Когда доставка?", "delivery"],
    ["Какая стоимость?", "pricing"],
    ["Здравствуйте", "other"],
  ]) {
    await t.test(topic, () => post(request(text), 200, ready(topic)));
  }
});

test("passes the original customer text to the classifier", async t => {
  const classifier = t.mock.fn(() => JSON.stringify({ topic: "other", draft: "Ответ" }));
  const post = await startServer(t, classifier);

  await post(JSON.stringify({ text: "  привет  ", id: 7 }), 200, ready("other", "Ответ"));
  assert.equal(classifier.mock.callCount(), 1);
  assert.equal(classifier.mock.calls[0].arguments[0], "  привет  ");
});

test("returns manual review for simulator failures", async t => {
  const post = await startServer(t);
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    await t.test(marker, () => post(request(marker), 200, manualReview));
  }
});

test("returns manual review for invalid model output", async t => {
  const valid = { topic: "other", draft: "Ответ" };
  const cases = [
    ["null result", null],
    ["array result", []],
    ["string result", "Ответ"],
    ["empty object", {}],
    ["missing topic", { draft: valid.draft }],
    ["missing draft", { topic: valid.topic }],
    ["null topic", { ...valid, topic: null }],
    ["capitalized topic", { ...valid, topic: "Delivery" }],
    ["null draft", { ...valid, draft: null }],
    ["number draft", { ...valid, draft: 7 }],
    ["object draft", { ...valid, draft: {} }],
    ["empty draft", { ...valid, draft: "" }],
    ["whitespace draft", { ...valid, draft: " \t\n" }],
  ];
  for (const [name, result] of cases) {
    await t.test(name, async t => {
      const post = await startServer(t, () => JSON.stringify(result));
      await post(request("Здравствуйте"), 200, manualReview);
    });
  }
});

test("selects only the public ready response fields", async t => {
  const post = await startServer(t, () => JSON.stringify({
    status: "manual_review",
    topic: "other",
    draft: "Ответ",
    provider: "simulator",
  }));

  await post(request("Здравствуйте"), 200, ready("other", "Ответ"));
});

test("returns manual review within the model deadline plus scheduling tolerance", async t => {
  const post = await startServer(t);
  const started = performance.now();
  await post(request("[timeout]"), 200, manualReview);
  const elapsed = performance.now() - started;
  const schedulingTolerance = 200;
  assert.ok(elapsed <= 300 + schedulingTolerance, `Timeout response took ${elapsed.toFixed(1)} ms`);
});

test("isolates concurrent requests and recovers after a timeout", async t => {
  const post = await startServer(t);
  await Promise.all([
    post(request("[timeout]"), 200, manualReview),
    post(request("Какая стоимость?"), 200, ready("pricing")),
  ]);
  await post(request("Когда доставка?"), 200, ready("delivery"));
});
