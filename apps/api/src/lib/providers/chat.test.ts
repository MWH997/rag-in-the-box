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

/**
 * Workers AI answers in two different shapes and the parser must read both.
 *
 * The original models send a bare `response` string. The OpenAI models hosted
 * on the platform, which includes the default chat model, send the OpenAI chat
 * completion shape instead and also stream `reasoning_content`. Reading only
 * the first shape produced a perfectly successful request that returned an
 * empty answer, with the token count climbing the whole time, and it reached
 * production before anyone noticed.
 */
describe("the workers ai stream shapes", () => {
  function bindingReturning(frames: string[]): Env {
    const body = frames.map((f) => `data: ${f}\n\n`).join("") + "data: [DONE]\n\n";
    return {
      AI: {
        run: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            },
          }),
      },
    } as unknown as Env;
  }

  async function collect(env: Env) {
    const result = streamChat(env, "workers-ai", {
      model: "@cf/openai/gpt-oss-20b",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      temperature: 0.1,
    });
    let text = "";
    for await (const chunk of result.stream) text += chunk.text;
    return { text, usage: result.usage() };
  }

  it("reads the bare response shape", async () => {
    const env = bindingReturning([
      JSON.stringify({ response: "Hello" }),
      JSON.stringify({ response: " world" }),
    ]);
    expect((await collect(env)).text).toBe("Hello world");
  });

  it("reads the openai chat completion shape", async () => {
    const env = bindingReturning([
      JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
      JSON.stringify({ choices: [{ delta: { content: " world" } }] }),
    ]);
    expect((await collect(env)).text).toBe("Hello world");
  });

  it("leaves the model's reasoning out of the answer", async () => {
    const env = bindingReturning([
      JSON.stringify({ choices: [{ delta: { reasoning_content: "User asks about" } }] }),
      JSON.stringify({ choices: [{ delta: { reasoning_content: " the framework. I should" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "The answer." } }] }),
    ]);
    const { text } = await collect(env);
    expect(text).toBe("The answer.");
    expect(text).not.toContain("I should");
  });

  it("counts the tokens the platform reports", async () => {
    const env = bindingReturning([
      JSON.stringify({ choices: [{ delta: { content: "a" } }], usage: { completion_tokens: 3 } }),
      JSON.stringify({ choices: [{ delta: { content: "b" } }], usage: { completion_tokens: 4 } }),
    ]);
    expect((await collect(env)).usage.completionTokens).toBe(7);
  });
});
