const fs = require("fs");
const path = require("path");

const recordFileName = (sessionId) => `${encodeURIComponent(sessionId)}.ndjson`;

const writeLine = (stream, value) =>
  new Promise((resolve, reject) => {
    const line = `${JSON.stringify(value)}\n`;
    let callbackComplete = false;
    let drainComplete = true;
    let settled = false;
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const settle = (error) => {
      if (settled) return;
      if (error) {
        settled = true;
        cleanup();
        reject(error);
        return;
      }
      if (callbackComplete && drainComplete) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onError = (error) => settle(error);
    const onDrain = () => {
      drainComplete = true;
      settle();
    };

    stream.once("error", onError);
    drainComplete = stream.write(line, (error) => {
      callbackComplete = true;
      settle(error);
    });
    if (!drainComplete) stream.once("drain", onDrain);
    settle();
  });

class RecordingStore {
  constructor(directory) {
    this.directory = directory;
    this.sessions = new Map();
  }

  async initialize() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    void this.cleanupOrphanSessions().catch(() => {});
  }

  async updateHeartbeat(sessionId, timestamp) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastHeartbeatAt = timestamp;
      const file = this.filePath(sessionId);
      try {
        const now = new Date(timestamp);
        await fs.promises.utimes(file, now, now);
      } catch (_) {}
    }
  }

  async cleanupOrphanSessions(stalenessThresholdMs = 60000) {
    try {
      const files = await fs.promises.readdir(this.directory);
      const now = Date.now();
      for (const file of files) {
        if (!file.endsWith(".ndjson")) continue;
        const filePath = path.join(this.directory, file);
        const stats = await fs.promises.stat(filePath);
        const ageMs = now - stats.mtimeMs;
        if (ageMs > stalenessThresholdMs) {
          const sessionId = decodeURIComponent(file.replace(/\.ndjson$/, ""));
          if (!this.sessions.has(sessionId)) {
            await fs.promises.unlink(filePath).catch(() => {});
          }
        }
      }
    } catch (_) {}
  }

  filePath(sessionId) {
    return path.join(this.directory, recordFileName(sessionId));
  }

  async startSession(sessionId, initialTrees, metadata) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Recording session "${sessionId}" is already open`);
    }

    await this.initialize();
    const stream = fs.createWriteStream(this.filePath(sessionId), {
      flags: "w",
    });
    await new Promise((resolve, reject) => {
      stream.once("open", resolve);
      stream.once("error", reject);
    });
    try {
      await writeLine(stream, {
        kind: "header",
        sessionId,
        metadata,
        initialTrees,
      });
      this.sessions.set(sessionId, { stream, finalTrees: undefined });
    } catch (error) {
      stream.destroy();
      throw new Error(
        `Failed to start recording session "${sessionId}": ${error.message}`,
      );
    }
  }

  async appendBatch(sessionId, records) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Recording session "${sessionId}" is not open`);
    }
    if (!Array.isArray(records)) {
      throw new Error("Recording append batch must be an array");
    }

    try {
      for (const record of records) {
        if (record.kind !== "event" && record.kind !== "snapshot") {
          throw new Error(
            `Unsupported recording batch record kind "${record.kind}"`,
          );
        }
        await writeLine(session.stream, record);
      }
    } catch (error) {
      throw new Error(
        `Failed to append recording session "${sessionId}": ${error.message}`,
      );
    }
  }

  async finalize(sessionId, finalTrees) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Recording session "${sessionId}" is not open`);
    }

    try {
      await writeLine(session.stream, { kind: "footer", finalTrees });
      await new Promise((resolve, reject) => {
        session.stream.once("close", resolve);
        session.stream.once("error", reject);
        session.stream.end();
      });
      this.sessions.delete(sessionId);
      return this.filePath(sessionId);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw new Error(
        `Failed to finalize recording session "${sessionId}": ${error.message}`,
      );
    }
  }

  async readRecords(sessionId) {
    const contents = await fs.promises.readFile(
      this.filePath(sessionId),
      "utf8",
    );
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.stream.destroy();
      this.sessions.delete(sessionId);
    }
    try {
      await fs.promises.unlink(this.filePath(sessionId));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(
          `Failed to delete recording session "${sessionId}": ${error.message}`,
        );
      }
    }
  }
}

module.exports = { RecordingStore };
