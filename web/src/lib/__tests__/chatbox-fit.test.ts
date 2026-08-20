import { describe, expect, it } from "vitest";
import { fitChatbox, graphemeLength, graphemeSlice } from "../chatbox-fit";

describe("fitChatbox", () => {
  it("returns short text unchanged", () => {
    expect(fitChatbox("hello")).toBe("hello");
    expect(fitChatbox("x".repeat(144))).toHaveLength(144);
  });

  it("trims a single long segment to 144 graphemes", () => {
    const out = fitChatbox("x".repeat(200), 144);
    expect(out).toBe("x".repeat(144));
    expect(graphemeLength(out)).toBe(144);
  });

  it("drops the last ` | ` segment first", () => {
    const keep = "A".repeat(80);
    const drop = "B".repeat(80);
    expect(fitChatbox(`${keep} | ${drop}`, 144)).toBe(keep);
  });

  it("drops the last ` / ` segment first", () => {
    const keep = "你好世界".repeat(20); // 80 CJK
    const drop = "翻訳行".repeat(30);
    expect(fitChatbox(`${keep} / ${drop}`, 144)).toBe(keep);
  });

  it("drops from the right across mixed separators", () => {
    const a = "CPU 50%";
    const b = "GPU 80%";
    const c = "L".repeat(140);
    expect(fitChatbox(`${a} | ${b} / ${c}`, 144)).toBe(`${a} | ${b}`);
  });

  it("does not split a ZWJ emoji grapheme (family)", () => {
    const family = "👨‍👩‍👧‍👦";
    const prefix = "x".repeat(143);
    const out = fitChatbox(prefix + family + "YYYY", 144);
    expect(graphemeLength(out)).toBe(144);
    expect(out.startsWith(prefix)).toBe(true);
    expect(out.endsWith(family)).toBe(true);
    expect(out.includes("Y")).toBe(false);
  });

  it("CJK grapheme trim does not use UTF-16 mid-char cuts", () => {
    const text = "汉".repeat(200);
    const out = fitChatbox(text, 144);
    expect(out).toBe("汉".repeat(144));
    expect(graphemeLength(out)).toBe(144);
  });

  it("graphemeSlice is a no-op when already short", () => {
    expect(graphemeSlice("ab", 10)).toBe("ab");
  });
});
