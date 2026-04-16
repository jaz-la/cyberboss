const net = require("net");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

class ClaudeCodeIpcServer extends EventEmitter {
  constructor({ socketPath }) {
    super();
    this.socketPath = socketPath;
    this.server = null;
    this.clients = new Set();
  }

  start() {
    if (this.server) return;
    this.ensureDirectory();
    this.removeStaleSocket();

    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      socket.setEncoding("utf8");

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this.emit("clientMessage", msg, socket);
          } catch {
            // ignore malformed
          }
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });
    });

    this.server.listen(this.socketPath, () => {
      fs.chmodSync(this.socketPath, 0o600);
    });
  }

  broadcast(event) {
    const payload = JSON.stringify(event) + "\n";
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }

  ensureDirectory() {
    const dir = path.dirname(this.socketPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  removeStaleSocket() {
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
  }

  async close() {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
      this.server = null;
    }

    this.removeStaleSocket();
  }
}

module.exports = { ClaudeCodeIpcServer };
