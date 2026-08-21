import { describe, expect, it } from "vitest";
import { parseInfoText, parseInfoUrl } from "@/lib/bundle-info";

describe("bundle-info", () => {
  it("parses current Unity cache __info manifests", () => {
    const parsed = parseInfoText("-1\n1787203483\n1\n__data\n");
    expect(parsed.format).toBe("unity-cache");
    expect(parsed.payload).toBe("__data");
    expect(parseInfoUrl(parsed.payload ?? "")).toEqual({ type: "unknown", id: null });
  });

  it("extracts avtr/wrld ids from legacy URL __info", () => {
    const url = "https://api.vrchat.cloud/api/1/file/file_x/1/file?avtr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(parseInfoUrl(url).type).toBe("avatar");
    expect(parseInfoUrl("https://api.vrchat.cloud/api/1/worlds/wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").id).toMatch(/^wrld_/);
  });
});
