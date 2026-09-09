import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("QA release candidate metadata", () => {
  it("keeps manifest and lockfile aligned and protects the stable distribution tag", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(pkg.version).toBe("0.8.0-rc.2");
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(pkg.publishConfig.tag).toBe("next");
    expect(pkg.publishConfig.provenance).toBe(true);
    expect(read("src/mcp/server.ts")).toContain(`version: "${pkg.version}"`);
    expect(pkg.bin).toEqual({
      "nayori-mcp": "./dist/mcp/cli.js",
      "nayori-custody": "./dist/custody/cli.js",
    });
  });

  it("separates the unpublished rc.2 from the immutable published rc.1", () => {
    const notes = read("docs/RELEASE_0.8.0_RC2.md");
    for (const phrase of ["Not published", "0.8.0-rc.2.tgz", "next", "latest",
      "version-1", "fresh reviewed budget", "not a funded E2E of rc.2"])
      expect(notes).toContain(phrase);
    expect(read("README.md")).toContain("RELEASE_0.8.0_RC2.md");
  });

  it("documents exact artifact installation without claiming publication or a new E2E", () => {
    const notes = read("docs/RELEASE_0.8.0_RC1.md");
for (const phrase of ["Published", "npm init -y", "--save-exact",
      "not this versioned artifact", "default v5/v4 contracts are unchanged",
"publication approval", "next", "latest", "fresh reviewed budget"])
      expect(notes).toContain(phrase);
    expect(read("docs/HERMES_MCP.md")).toContain("perkos-agent-sdk-0.8.0-rc.1.tgz");
    expect(read("README.md")).toContain("RELEASE_0.8.0_RC1.md");
  });
});
