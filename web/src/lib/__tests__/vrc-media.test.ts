import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateImageUploadGate,
  fileImageUrl,
  fileToBase64,
  isVrcPlusSupporter,
  listFiles,
  listInventory,
  listPrints,
  printImageUrl,
  uploadImageFile,
  uploadPrint,
  VRC_PLUS_SLOT_LIMITS,
} from "../vrc-media";
import { ipc } from "../ipc";
import type { VrcFile, VrcPrint } from "../types";

vi.mock("../ipc", () => ({
  ipc: {
    boopUser: vi.fn(),
    inventoryList: vi.fn(),
    printsList: vi.fn(),
    printsGet: vi.fn(),
    printsUpload: vi.fn(),
    printsDelete: vi.fn(),
    filesList: vi.fn(),
    filesUploadImage: vi.fn(),
    filesDelete: vi.fn(),
    avatarsUpdateImage: vi.fn(),
  },
}));

const m = ipc as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fileToBase64", () => {
  it("strips the data: URI prefix and returns bare base64", async () => {
    // "ab" => base64 "YWI="
    const blob = new Blob(["ab"], { type: "image/png" });
    const out = await fileToBase64(blob);
    expect(out).toBe("YWI=");
  });
});

describe("list helpers normalize missing/garbage payloads", () => {
  it("listPrints returns [] when prints missing", async () => {
    m.printsList.mockResolvedValue({});
    expect(await listPrints()).toEqual([]);
  });

  it("listFiles returns [] when files missing", async () => {
    m.filesList.mockResolvedValue({ files: null });
    expect(await listFiles("gallery")).toEqual([]);
    expect(m.filesList).toHaveBeenCalledWith("gallery");
  });

  it("listInventory passes through data + totalCount", async () => {
    m.inventoryList.mockResolvedValue({ data: [{ id: "a" }], totalCount: 1 });
    const r = await listInventory("sticker", 50, 0);
    expect(r.data).toHaveLength(1);
    expect(r.totalCount).toBe(1);
    expect(m.inventoryList).toHaveBeenCalledWith("sticker", 50, 0);
  });

  it("listInventory tolerates non-array data", async () => {
    m.inventoryList.mockResolvedValue({ data: undefined });
    expect((await listInventory()).data).toEqual([]);
  });
});

describe("upload helpers convert blob to base64 before calling ipc", () => {
  it("uploadPrint sends bare base64 + timestamp", async () => {
    m.printsUpload.mockResolvedValue({ id: "p1" });
    const blob = new Blob(["ab"], { type: "image/png" });
    await uploadPrint(blob, { note: "hi", timestamp: "2026-01-01T00:00:00Z" });
    expect(m.printsUpload).toHaveBeenCalledWith({
      imageBase64: "YWI=",
      timestamp: "2026-01-01T00:00:00Z",
      note: "hi",
      worldId: undefined,
      worldName: undefined,
    });
  });

  it("uploadImageFile forwards tag + matchingDimensions", async () => {
    m.filesUploadImage.mockResolvedValue({ id: "f1" });
    const blob = new Blob(["ab"], { type: "image/png" });
    await uploadImageFile(blob, "icon", true);
    expect(m.filesUploadImage).toHaveBeenCalledWith({
      imageBase64: "YWI=",
      tag: "icon",
      matchingDimensions: true,
    });
  });
});

describe("url resolvers", () => {
  it("fileImageUrl picks newest non-deleted version", () => {
    const file: VrcFile = {
      id: "f",
      versions: [
        { version: 0, file: { url: "v0" } },
        { version: 1, file: { url: "v1" }, deleted: true },
        { version: 2, file: { url: "v2" } },
      ],
    };
    expect(fileImageUrl(file)).toBe("v2");
  });

  it("fileImageUrl returns null when nothing usable", () => {
    expect(fileImageUrl({ id: "f", versions: [] })).toBeNull();
    expect(fileImageUrl({ id: "f" })).toBeNull();
  });

  it("printImageUrl prefers files.image then top-level image", () => {
    expect(printImageUrl({ id: "p", files: { image: "a" }, image: "b" } as VrcPrint)).toBe("a");
    expect(printImageUrl({ id: "p", image: "b" } as VrcPrint)).toBe("b");
    expect(printImageUrl({ id: "p" } as VrcPrint)).toBeNull();
  });
});

describe("isVrcPlusSupporter", () => {
  it("true only when system_supporter is present", () => {
    expect(isVrcPlusSupporter(["system_supporter", "language_eng"])).toBe(true);
    expect(isVrcPlusSupporter(["language_eng"])).toBe(false);
  });

  it("early_adopter alone is NOT an active subscription", () => {
    expect(isVrcPlusSupporter(["system_early_adopter"])).toBe(false);
  });

  it("tolerates null / undefined / non-array", () => {
    expect(isVrcPlusSupporter(null)).toBe(false);
    expect(isVrcPlusSupporter(undefined)).toBe(false);
    expect(isVrcPlusSupporter([])).toBe(false);
  });
});

describe("evaluateImageUploadGate", () => {
  it("avatarimage is never VRC+ gated, regardless of supporter status", () => {
    expect(evaluateImageUploadGate("avatarimage", false)).toEqual({ allowed: true });
    expect(evaluateImageUploadGate("avatarimage", true, 9999)).toEqual({ allowed: true });
  });

  it("supporter-only purposes are blocked for non-supporters", () => {
    expect(evaluateImageUploadGate("gallery", false)).toEqual({
      allowed: false,
      reason: "supporter_required",
    });
    expect(evaluateImageUploadGate("icon", false)).toEqual({
      allowed: false,
      reason: "supporter_required",
    });
    expect(evaluateImageUploadGate("sticker", false)).toEqual({
      allowed: false,
      reason: "supporter_required",
    });
  });

  it("supporters may upload gallery/icon with no count limit", () => {
    expect(evaluateImageUploadGate("gallery", true, 1000)).toEqual({ allowed: true });
    expect(evaluateImageUploadGate("icon", true, 1000)).toEqual({ allowed: true });
  });

  it("enforces the sticker/emoji slot cap for supporters", () => {
    const limit = VRC_PLUS_SLOT_LIMITS.sticker!;
    expect(evaluateImageUploadGate("sticker", true, limit - 1)).toEqual({ allowed: true });
    expect(evaluateImageUploadGate("sticker", true, limit)).toEqual({
      allowed: false,
      reason: "limit_reached",
      limit,
      current: limit,
    });
    expect(evaluateImageUploadGate("emoji", true, VRC_PLUS_SLOT_LIMITS.emoji!)).toEqual({
      allowed: false,
      reason: "limit_reached",
      limit: VRC_PLUS_SLOT_LIMITS.emoji!,
      current: VRC_PLUS_SLOT_LIMITS.emoji!,
    });
  });

  it("emojianimated has no client-side count cap (server decides)", () => {
    expect(evaluateImageUploadGate("emojianimated", true, 9999)).toEqual({ allowed: true });
  });
});
