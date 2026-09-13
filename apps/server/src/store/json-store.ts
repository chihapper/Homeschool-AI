/**
 * Minimal file-backed store: one JSON file per record under data/<collection>/<id>.json.
 *
 * Deliberately simple. Swap for a database by implementing the same four methods.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { config } from "../config.js";

export class JsonStore<T extends { id: string }> {
  constructor(
    private readonly collection: string,
    private readonly schema: z.ZodType<T>,
    private readonly dataDir: string = config.dataDir,
  ) {}

  private dir(): string {
    const d = path.join(this.dataDir, this.collection);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  private file(id: string): string {
    if (!/^[\w.-]+$/.test(id)) throw new Error(`Invalid id: ${id}`);
    return path.join(this.dir(), `${id}.json`);
  }

  newId(): string {
    return randomUUID();
  }

  get(id: string): T | undefined {
    const f = this.file(id);
    if (!fs.existsSync(f)) return undefined;
    return this.schema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  }

  require(id: string): T {
    const v = this.get(id);
    if (!v) throw new Error(`${this.collection}/${id} not found`);
    return v;
  }

  put(value: T): T {
    const parsed = this.schema.parse(value);
    const f = this.file(parsed.id);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2));
    fs.renameSync(tmp, f);
    return parsed;
  }

  delete(id: string): void {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  list(): T[] {
    return fs
      .readdirSync(this.dir())
      .filter((n) => n.endsWith(".json"))
      .map((n) => this.get(n.slice(0, -5)))
      .filter((v): v is T => Boolean(v));
  }
}
