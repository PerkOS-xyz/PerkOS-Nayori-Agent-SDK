import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("stable release metadata", () => {
  it("keeps manifest, lockfile and stable distribution policy aligned", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(pkg.version).toBe("0.8.0");
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(pkg.publishConfig.tag).toBe("latest");
    expect(pkg.publishConfig.provenance).toBe(false);
    expect(read("src/mcp/server.ts")).toContain(`version: "${pkg.version}"`);
    expect(pkg.bin).toEqual({
      "nayori-mcp": "./dist/mcp/cli.js",
      "nayori-custody": "./dist/custody/cli.js",
    });
  });

  it("records the stable publication boundary without claiming a registry E2E", () => {
    const notes = read("docs/RELEASE_0.8.0.md");
    for (const phrase of ["0.8.0", "--save-exact", "latest", "415 tests",
      "must not be described as a `0.8.0` registry E2E",
      "internal-team-operated-not-m2-adoption"])
      expect(notes).toContain(phrase);
    expect(read("README.md")).toContain("RELEASE_0.8.0.md");
  });

  it("preserves the historical rc.2 publication record", () => {
    const notes = read("docs/RELEASE_0.8.0_RC2.md");
    for (const phrase of ["Published on npm", "0.8.0-rc.2.tgz", "next", "latest",
      "version-1", "fresh reviewed budget", "not a funded E2E of rc.2"])
      expect(notes).toContain(phrase);
  });

  it("documents exact artifact installation without claiming publication or a new E2E", () => {
    const notes = read("docs/RELEASE_0.8.0_RC1.md");
for (const phrase of ["Published", "npm init -y", "--save-exact",
      "not this versioned artifact", "default v5/v4 contracts are unchanged",
"publication approval", "next", "latest", "fresh reviewed budget"])
      expect(notes).toContain(phrase);
    expect(read("README.md")).toContain("RELEASE_0.8.0_RC1.md");
  });
});
