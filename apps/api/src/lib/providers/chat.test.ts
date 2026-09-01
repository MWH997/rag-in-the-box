import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { streamChat } from "./chat.js";
import type { Env } from "../../env.js";

/**
 * The answer tuning is per workspace, which is only true if the values reach
 * the model. Storing them and showing them back is the easy half; these tests
 * watch the outbound request instead, against a server that records what it
 * was sent.
 */

let server: Server;
let base: string;
const received: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => server.close());

async function ask(maxTokens: number, temperature: number) {
  const env = { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: base } as unknown as Env;
  const result = streamChat(env, "openai", {
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: "hi" }],
    maxTokens,
    temperature,
  });
  for await (const _chunk of result.stream) {
    // Drain, so the request completes before the assertion.
  }
  return received.at(-1)!;
}

describe("answer tuning", () => {
  it("sends the answer length it was given", async () => {
    expect((await ask(700, 0.1)).max_tokens).toBe(700);
    expect((await ask(1500, 0.1)).max_tokens).toBe(1500);
  });

  it("sends the temperature it was given", async () => {
    expect((await ask(700, 0.1)).temperature).toBe(0.1);
    expect((await ask(700, 0.7)).temperature).toBe(0.7);
  });

  it("honours the endpoint override, so a region or proxy is reachable", async () => {
    // If this ever regressed the request would go to api.openai.com and the
    // recording server would see nothing, so the count is the assertion.
    const before = received.length;
    await ask(256, 0.2);
    expect(received.length).toBe(before + 1);
  });
});
