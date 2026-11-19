import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response, classifyRequest) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (typeof input?.text !== "string" || input.text.trim().length === 0) {
    return json(response, 400, { status: "invalid_input" });
  }

  const { text } = input;
  let result;
  try {
    result = JSON.parse(await classifyRequest(text, { signal: AbortSignal.timeout(300) }));
  } catch {
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }

  const { topic, draft } = result ?? {};
  if (!["delivery", "pricing", "other"].includes(topic) ||
      typeof draft !== "string" || draft.trim().length === 0) {
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }

  return json(response, 200, { status: "ready", topic, draft });
}

export function createTriageServer(classifyRequest = classify) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response, classifyRequest);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createTriageServer();
  server.listen(Number(process.env.PORT || 3000), "127.0.0.1", () => {
    const { address, port } = server.address();
    console.log(`Server is running at http://${address}:${port}`);
  });
}
