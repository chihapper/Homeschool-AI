import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { JsonStore } from "../src/store/json-store.js";

describe("JsonStore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-"));
  const store = new JsonStore("things", z.object({ id: z.string(), n: z.number() }), dir);

  it("round-trips and lists", () => {
    store.put({ id: "a", n: 1 });
    store.put({ id: "b", n: 2 });
    expect(store.get("a")).toEqual({ id: "a", n: 1 });
    expect(store.list().map((t) => t.id).sort()).toEqual(["a", "b"]);
    store.delete("a");
    expect(store.get("a")).toBeUndefined();
    expect(() => store.require("a")).toThrow(/not found/);
  });

  it("rejects unsafe ids", () => {
    expect(() => store.get("../etc/passwd")).toThrow(/Invalid id/);
  });
});
