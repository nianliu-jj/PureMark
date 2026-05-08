import assert from "node:assert/strict";
import test from "node:test";

const LAST_SESSION_KEY = "puremark-last-session";

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  clear() {
    this.#items.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  dispatchEvent() {
    return true;
  },
};

let importCounter = 0;

function seedLastSession(snapshot) {
  localStorage.clear();
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(snapshot));
}

async function loadLaunchState() {
  importCounter += 1;
  return import(`../src/services/launchState.ts?case=${importCounter}`);
}

test("启动恢复完成前不会用空白默认标签页覆盖上次会话文件列表", async () => {
  const launchState = await loadLaunchState();
  seedLastSession({
    windowLabel: "main",
    workspacePath: "D:/notes",
    openFilePaths: ["D:/notes/a.md", "D:/notes/b.md"],
    activeFilePath: "D:/notes/b.md",
    updatedAt: 1000,
  });

  launchState.saveLastSessionSnapshot({
    windowLabel: "main",
    workspacePath: "D:/notes",
    openFilePaths: [],
    activeFilePath: null,
  });

  assert.deepEqual(launchState.getLastSessionSnapshot()?.openFilePaths, [
    "D:/notes/a.md",
    "D:/notes/b.md",
  ]);
  assert.equal(launchState.getLastSessionSnapshot()?.activeFilePath, "D:/notes/b.md");
});

test("启动恢复完成时只恢复目录不会清空上次会话文件列表", async () => {
  const launchState = await loadLaunchState();
  seedLastSession({
    windowLabel: "main",
    workspacePath: "D:/notes",
    openFilePaths: ["D:/notes/a.md", "D:/notes/b.md"],
    activeFilePath: "D:/notes/b.md",
    updatedAt: 1000,
  });

  launchState.saveLastSessionSnapshot({
    windowLabel: "main",
    workspacePath: "D:/other-notes",
    openFilePaths: [],
    activeFilePath: null,
  });
  launchState.enableLastSessionSnapshotPersistence();

  assert.equal(launchState.getLastSessionSnapshot()?.workspacePath, "D:/notes");
  assert.deepEqual(launchState.getLastSessionSnapshot()?.openFilePaths, [
    "D:/notes/a.md",
    "D:/notes/b.md",
  ]);
  assert.equal(launchState.getLastSessionSnapshot()?.activeFilePath, "D:/notes/b.md");
});

test("启动恢复完成后允许保存当前会话文件列表", async () => {
  const launchState = await loadLaunchState();
  seedLastSession({
    windowLabel: "main",
    workspacePath: "D:/notes",
    openFilePaths: ["D:/notes/a.md"],
    activeFilePath: "D:/notes/a.md",
    updatedAt: 1000,
  });

  launchState.enableLastSessionSnapshotPersistence();

  launchState.saveLastSessionSnapshot({
    windowLabel: "main",
    workspacePath: "D:/notes",
    openFilePaths: ["D:/notes/c.md"],
    activeFilePath: "D:/notes/c.md",
  });

  assert.deepEqual(launchState.getLastSessionSnapshot()?.openFilePaths, ["D:/notes/c.md"]);
  assert.equal(launchState.getLastSessionSnapshot()?.activeFilePath, "D:/notes/c.md");
});
