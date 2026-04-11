import { appendFileSync, mkdirSync, existsSync } from "fs";

type LogLevel = "info" | "warn" | "error" | "debug";

export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

const LOG_DIR = "./logs";
let logFileReady = false;

function ensureLogDir() {
  if (!logFileReady) {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    logFileReady = true;
  }
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${LOG_DIR}/hanni-${date}.log`;
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  return " " + args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
}

function log(level: LogLevel, component: string, msg: string, args: unknown[]) {
  const prefix = `${timestamp()} [${level.toUpperCase()}] [${component}]`;
  const line = `${prefix} ${msg}${formatArgs(args)}`;

  // stdout (for docker logs)
  console.log(line);

  // file (persists across container recreates)
  try {
    ensureLogDir();
    appendFileSync(getLogFilePath(), line + "\n");
  } catch {
    // don't crash if file write fails
  }
}

export function createLogger(component: string): Logger {
  return {
    info: (msg, ...args) => log("info", component, msg, args),
    warn: (msg, ...args) => log("warn", component, msg, args),
    error: (msg, ...args) => log("error", component, msg, args),
    debug: (msg, ...args) => {
      if (process.env.BRO_DEBUG) log("debug", component, msg, args);
    },
  };
}
