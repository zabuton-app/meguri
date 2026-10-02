// The committed WebAssembly module is what assembly/forces.ts compiles to.
import { describe, expect, it } from "vitest";
import { compileForces, moduleText } from "../../../scripts/build-wasm.mjs";
import { FORCES_WASM_BASE64 } from "../sim/forcesWasm";

describe("forcesWasm", () => {
  it("is up to date with assembly/forces.ts (run `npm run build:wasm`)", async () => {
    const binary = await compileForces();
    expect(Buffer.from(binary).toString("base64")).toBe(FORCES_WASM_BASE64);
    expect(moduleText(binary)).toContain(FORCES_WASM_BASE64);
  }, 60_000);
});
