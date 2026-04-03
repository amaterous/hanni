#!/usr/bin/env bun
/**
 * Unit test for parseResultMetadata — no LLM calls, instant.
 * Usage: bun test-parse-result.ts
 */
import { parseResultMetadata } from "../src/session/orchestration-prompt";

interface TestCase {
  name: string;
  input: string;
  expect: {
    issueIdentifier?: string;
    branch?: string;
    prUrl?: string;
    hasResultText: boolean;
  };
}

const tests: TestCase[] = [
  {
    name: "全メタデータあり",
    input: `実装したよ！

\`\`\`
__RESULT__
TICKET: YUN-400
BRANCH: hanni/yun-400-new-feature
PR: https://github.com/yuppppppppppqi/iq-test/pull/42
\`\`\``,
    expect: {
      issueIdentifier: "YUN-400",
      branch: "hanni/yun-400-new-feature",
      prUrl: "https://github.com/yuppppppppppqi/iq-test/pull/42",
      hasResultText: true,
    },
  },
  {
    name: "チケットだけ",
    input: `作業したよ〜

\`\`\`
__RESULT__
TICKET: YUN-401
\`\`\``,
    expect: {
      issueIdentifier: "YUN-401",
      branch: undefined,
      prUrl: undefined,
      hasResultText: true,
    },
  },
  {
    name: "メタデータなし（普通の応答）",
    input: "動かしたよ！結果はこんな感じ:\nOK — 5 articles fetched",
    expect: {
      issueIdentifier: undefined,
      branch: undefined,
      prUrl: undefined,
      hasResultText: true,
    },
  },
  {
    name: "空文字",
    input: "",
    expect: {
      issueIdentifier: undefined,
      branch: undefined,
      prUrl: undefined,
      hasResultText: false,
    },
  },
  {
    name: "ブランチとPRだけ（チケットなし）",
    input: `修正したよ

\`\`\`
__RESULT__
BRANCH: hanni/quick-fix
PR: https://github.com/yuppppppppppqi/iq-test/pull/99
\`\`\``,
    expect: {
      issueIdentifier: undefined,
      branch: "hanni/quick-fix",
      prUrl: "https://github.com/yuppppppppppqi/iq-test/pull/99",
      hasResultText: true,
    },
  },
];

let passed = 0;
let failed = 0;

console.log(`\n🧪 parseResultMetadata Unit Test — ${tests.length} cases\n`);

for (const t of tests) {
  const result = parseResultMetadata(t.input);
  const errors: string[] = [];

  if (result.issueIdentifier !== t.expect.issueIdentifier) {
    errors.push(`  issueIdentifier: "${result.issueIdentifier}" !== "${t.expect.issueIdentifier}"`);
  }
  if (result.branch !== t.expect.branch) {
    errors.push(`  branch: "${result.branch}" !== "${t.expect.branch}"`);
  }
  if (result.prUrl !== t.expect.prUrl) {
    errors.push(`  prUrl: "${result.prUrl}" !== "${t.expect.prUrl}"`);
  }
  if (t.expect.hasResultText && !result.resultText) {
    errors.push(`  resultText: expected non-empty, got empty`);
  }
  if (!t.expect.hasResultText && result.resultText) {
    errors.push(`  resultText: expected empty, got "${result.resultText.slice(0, 40)}"`);
  }

  if (errors.length === 0) {
    console.log(`  OK  ${t.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${t.name}`);
    errors.forEach((e) => console.log(`    ${e}`));
    failed++;
  }
}

console.log(`\n--- 結果 ---`);
console.log(`  PASS: ${passed}/${tests.length}`);
console.log(`  FAIL: ${failed}/${tests.length}`);
console.log();

if (failed > 0) process.exit(1);
