#!/usr/bin/env bun
/**
 * Test hanni's chat mode locally.
 * Usage: bun test-chat.ts "チケット一覧見せて"
 */
import { loadConfig } from "../src/config";
import { chatOrClassify } from "../src/slack/chat";

const message = process.argv[2];
if (!message) {
  console.error("Usage: bun test-chat.ts \"メッセージ\"");
  process.exit(1);
}

const config = loadConfig();
console.log(`\n💬 "${message}"\n`);
console.log("⏳ thinking...\n");

const result = await chatOrClassify(message, config, undefined, "Yun");

if (result === null) {
  console.log("→ __CODE_TASK__ (コードタスクとして処理される)");
} else {
  console.log(`→ ${result}`);
}
