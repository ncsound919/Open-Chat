const { NtfyClient } = require("./src/protocols/NtfyClient.js");

(async () => {
  const lines = [
    "{}",
    '{"event":"message","id":"m1","title":"T","message":"B"}',
    "",
  ];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  const res = new Response(stream, { status: 200 });
  console.log("res.body type:", res.body ? res.body.constructor.name : "null");

  const c = new NtfyClient("localhost", 80, "", "alerts");
  c.onMessage = (m) => console.log("ONMSG", m.id);
  try {
    await c.connect();
  } catch (e) {
    console.log("connect error:", e.message);
  }
  setTimeout(() => console.log("done waiting"), 100);
})();
