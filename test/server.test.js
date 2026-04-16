const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../server");

const getJson = async (path) => {
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
};

test("GET /health returns OK status", async () => {
  const { status, body } = await getJson("/health");

  assert.equal(status, 200);
  assert.deepEqual(body, { status: "OK" });
});
