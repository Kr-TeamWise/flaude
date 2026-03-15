/**
 * SDK Runner — long-running process with bidirectional stdin/stdout
 *
 * Protocol:
 *   First stdin line: JSON config (SdkConfig)
 *   Subsequent stdin lines (streaming mode only):
 *     {"type":"interject","text":"..."} — inject message mid-conversation via streamInput
 *     {"type":"stop"} — interrupt the current query
 *
 * Output (stdout) — one JSON per line:
 *   {"type":"delta","text":"chunk"}       — text delta (streaming mode)
 *   {"type":"status","status":"thinking"} — status update
 *   {"type":"result","session_id":"...","result":"...","cost_usd":...,"num_turns":...}
 *   {"type":"error","error":"..."}
 *
 * Non-streaming mode (stream: false):
 *   Single JSON output: {"session_id":"...","result":"...","cost_usd":...,"num_turns":...}
 */

import { query, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline";

interface SdkConfig {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  agents: Record<string, { description?: string; prompt?: string; tools?: string[] }>;
  sessionId: string | null;
  resume: boolean;
  continue: boolean;
  model: "sonnet" | "opus" | "haiku";
  permissionMode: "acceptEdits" | "bypassPermissions";
  enableCheckpointing: boolean;
  cwd: string | null;
  maxTurns?: number;
  maxBudgetUsd?: number;
  effort?: "low" | "medium" | "high";
  stream?: boolean;
}

function emit(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function buildOptions(config: SdkConfig): Options {
  const opts: Options = {
    model: config.model || "opus",
    permissionMode: config.permissionMode || "bypassPermissions",
  };

  if (config.systemPrompt) opts.systemPrompt = config.systemPrompt;
  if (config.allowedTools?.length > 0) opts.allowedTools = config.allowedTools;
  if (config.disallowedTools?.length > 0) opts.disallowedTools = config.disallowedTools;
  if (config.permissionMode === "bypassPermissions") opts.allowDangerouslySkipPermissions = true;
  if (config.agents && Object.keys(config.agents).length > 0) opts.agents = config.agents;

  if (config.continue) {
    opts.continue = true;
  } else if (config.sessionId && config.resume) {
    opts.resume = config.sessionId;
  } else if (config.sessionId) {
    opts.sessionId = config.sessionId;
  }

  if (config.maxTurns != null) opts.maxTurns = config.maxTurns;
  if (config.maxBudgetUsd != null) opts.maxBudgetUsd = config.maxBudgetUsd;
  if (config.enableCheckpointing) opts.enableFileCheckpointing = true;
  if (config.effort) (opts as any).effort = config.effort;
  if (config.cwd) opts.cwd = config.cwd;
  if (config.stream) opts.includePartialMessages = true;

  return opts;
}

/**
 * Build an SDKUserMessage from plain text.
 */
function makeUserMessage(text: string, sessionId: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

async function run() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  // Read first line as config
  const configLine = await new Promise<string>((resolve, reject) => {
    rl.once("line", resolve);
    rl.once("close", () => reject(new Error("stdin closed before config")));
  });

  let config: SdkConfig;
  try {
    config = JSON.parse(configLine);
  } catch (e) {
    console.log(JSON.stringify({ error: `Invalid input JSON: ${e}` }));
    process.exit(1);
  }

  if (!config.prompt) {
    console.log(JSON.stringify({ error: "Empty prompt" }));
    process.exit(1);
  }

  const opts = buildOptions(config);

  // Start query with string prompt (works for both streaming and non-streaming)
  let queryHandle: Query;
  try {
    queryHandle = query({ prompt: config.prompt, options: opts });
  } catch (e: any) {
    const err = { error: e.message || String(e) };
    if (config.stream) emit({ type: "error", ...err });
    else console.log(JSON.stringify(err));
    process.exit(1);
  }

  // In streaming mode, listen for interject/stop commands on stdin
  if (config.stream) {
    let sessionId = "";
    rl.on("line", (line: string) => {
      try {
        const cmd = JSON.parse(line);
        if (cmd.type === "interject" && cmd.text) {
          // Use streamInput to inject a message mid-conversation
          const msg = makeUserMessage(cmd.text, sessionId);
          async function* singleMessage(): AsyncGenerator<SDKUserMessage> {
            yield msg;
          }
          queryHandle.streamInput(singleMessage()).catch(() => {});
        } else if (cmd.type === "stop") {
          queryHandle.interrupt().catch(() => {});
        }
      } catch {
        // Ignore malformed lines
      }
    });

    rl.on("close", () => {
      queryHandle.close();
    });

    // Process streaming output
    try {
      let resultText = "";
      let costUsd: number | null = null;
      let numTurns = 0;

      for await (const message of queryHandle) {
        if (message.type === "stream_event") {
          const event = (message as any).event;
          if (event?.type === "content_block_delta" && event?.delta?.type === "text_delta" && event?.delta?.text) {
            emit({ type: "delta", text: event.delta.text });
          }
        } else if (message.type === "status") {
          emit({ type: "status", status: (message as any).status || "" });
        } else if (message.type === "result") {
          resultText = (message.result || "").trim();
          sessionId = message.session_id || sessionId;
          costUsd = message.cost_usd ?? null;
          numTurns = message.num_turns ?? 0;
        }
      }

      emit({
        type: "result",
        session_id: sessionId,
        result: resultText,
        cost_usd: costUsd,
        num_turns: numTurns,
      });
    } catch (e: any) {
      emit({ type: "error", error: e.message || String(e) });
      process.exit(1);
    }
  } else {
    // Non-streaming: simple run
    rl.close();
    try {
      let sessionId = config.sessionId || "";
      let resultText = "";
      let costUsd: number | null = null;
      let numTurns = 0;

      for await (const message of queryHandle) {
        if (message.type === "result") {
          resultText = (message.result || "").trim();
          sessionId = message.session_id || sessionId;
          costUsd = message.cost_usd ?? null;
          numTurns = message.num_turns ?? 0;
        }
      }

      console.log(JSON.stringify({
        session_id: sessionId,
        result: resultText,
        cost_usd: costUsd,
        num_turns: numTurns,
      }));
    } catch (e: any) {
      console.log(JSON.stringify({ error: e.message || String(e) }));
      process.exit(1);
    }
  }
}

run();
