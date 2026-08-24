"use strict";

const { spawn } = require("node:child_process");
const { constants } = require("node:os");

const { prepareBaseline, restoreBaseline } = require("./release-baseline.cjs");

function runSemanticRelease(cwd, args) {
  return new Promise((resolve, reject) => {
    const binary = require.resolve("semantic-release/bin/semantic-release.js");
    const child = spawn(process.execPath, [binary, ...args], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    let signal;
    let settled = false;
    const handlers = {};
    const removeSignalHandlers = () => {
      for (const [name, handler] of Object.entries(handlers)) {
        process.removeListener(name, handler);
      }
    };
    const forwardSignal = (received) => {
      if (!signal) {
        signal = received;
        child.kill(received);
      }
    };
    handlers.SIGINT = () => forwardSignal("SIGINT");
    handlers.SIGTERM = () => forwardSignal("SIGTERM");
    process.once("SIGINT", handlers.SIGINT);
    process.once("SIGTERM", handlers.SIGTERM);
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      removeSignalHandlers();
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      if (settled) {
        return;
      }
      settled = true;
      removeSignalHandlers();
      resolve({ code, signal: childSignal || signal });
    });
  });
}

async function main() {
  const cwd = process.cwd();
  const state = prepareBaseline(cwd);
  let result;
  let restoreError;
  try {
    result = await runSemanticRelease(cwd, process.argv.slice(2));
  } finally {
    try {
      restoreBaseline(state);
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError) {
    throw restoreError;
  }
  if (result.signal) {
    process.exitCode = 128 + (constants.signals[result.signal] || 1);
  } else {
    process.exitCode = result.code ?? 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
