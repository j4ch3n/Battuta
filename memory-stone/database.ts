import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { loadStone, type Stone } from "./stone.ts";

let activePath: string | undefined;
export class MemoryDatabase {
  readonly stone: Stone;
  private inTransaction = false;
  private constructor(stone: Stone) {
    this.stone = stone;
  }

  static async open(path: string): Promise<MemoryDatabase> {
    path = resolve(path);
    if (activePath) throw new Error("A memory database is already open in this process");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(path, {
      realpath: false,
      retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
      stale: 10000,
    });
    try {
      if (activePath) throw new Error("A memory database is already open in this process");
      process.env.PI_MEMORY_STONE_DB_PATH = path;
      const stone = await loadStone();
      stone.db.getDb();
      activePath = path;
      return new MemoryDatabase(stone);
    } finally {
      await release();
    }
  }

  transaction<T>(operation: () => T): T {
    if (this.inTransaction) return operation();
    const db = this.stone.db.getDb();
    db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  close() {
    this.stone.db.closeDb();
    activePath = undefined;
  }
}
