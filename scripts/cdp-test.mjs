// cdp-test.mjs — enable console capture, trigger a query, collect console/log
// events for a window, print them.
// Usage: node cdp-test.mjs <wsUrl> <jsToType> <seconds>
const wsUrl = process.argv[2];
const jsToType = process.argv[3];
const seconds = Number(process.argv[4] || 40);

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const logs = [];

function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type ?? "").join(" ");
    logs.push(`[console.${msg.params.type}] ${args.slice(0, 500)}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d?.exception?.description || d?.text || ""}`.slice(0, 600));
  } else if (msg.method === "Log.entryAdded") {
    logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`.slice(0, 500));
  }
};

ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Log.enable");
  // Type + send the query.
  await send("Runtime.evaluate", {
    expression: jsToType,
    returnByValue: true,
  });
  logs.push("[triggered query]");
  setTimeout(() => {
    console.log(JSON.stringify(logs, null, 1));
    process.exit(0);
  }, seconds * 1000);
};

ws.onerror = (err) => {
  console.error("ws error:", err?.message || String(err));
  process.exit(1);
};