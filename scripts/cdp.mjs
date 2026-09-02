// cdp.mjs — evaluate a JS expression in the Open-Chat WebView via CDP.
// Usage: node cdp.mjs <wsUrl> <expression>
const wsUrl = process.argv[2];
const expr = process.argv[3];

const ws = new WebSocket(wsUrl);
const timer = setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 20000);

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    })
  );
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id === 1) {
    clearTimeout(timer);
    if (msg.result?.exceptionDetails) {
      console.error("EXCEPTION:", JSON.stringify(msg.result.exceptionDetails, null, 2));
    } else {
      console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));
    }
    ws.close();
    process.exit(0);
  }
};

ws.onerror = (err) => {
  clearTimeout(timer);
  console.error("ws error:", err?.message || String(err));
  process.exit(1);
};