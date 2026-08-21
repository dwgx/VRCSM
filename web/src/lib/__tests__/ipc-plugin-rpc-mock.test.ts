/**
 * P17-B11: plugin.rpc + plugin-only FS/path mocks must resolve in browser-dev
 * instead of throwing mock_not_implemented (smoke treats that as a dead IPC).
 */
import { describe, expect, it } from "vitest";
import { ipc, IpcError } from "../ipc";

describe("mock IPC — plugin.rpc and plugin-only methods", () => {
  it("is on the mock path in jsdom", () => {
    expect(ipc.isMock).toBe(true);
  });

  it("plugin.rpc dispatches an inner mocked method", async () => {
    const listed = await ipc.pluginRpc<
      { path?: string },
      { path: string; entries: unknown[]; roots: unknown[]; truncated: boolean }
    >("fs.listDir", { path: "C:\\Mock" });
    expect(listed.path).toBe("C:\\Mock");
    expect(Array.isArray(listed.entries)).toBe(true);
    expect(listed.truncated).toBe(false);
  });

  it("plugin.rpc rejects missing method and plugin.* recursion", async () => {
    await expect(ipc.pluginRpc("")).rejects.toMatchObject({
      code: "invalid_params",
    });
    await expect(ipc.call("plugin.rpc", { method: "plugin.list" })).rejects.toBeInstanceOf(
      IpcError,
    );
    try {
      await ipc.call("plugin.rpc", { method: "plugin.list" });
      expect.fail("expected forbidden_method");
    } catch (err) {
      expect(err).toBeInstanceOf(IpcError);
      expect((err as IpcError).code).toBe("forbidden_method");
    }
  });

  it("mocks plugin-only fs.writePlan / fs.appDataDir without touching disk", async () => {
    const plan = await ipc.call<
      { rootPath: string; content: string },
      { ok: boolean; path: string; bytes: number }
    >("fs.writePlan", { rootPath: "C:\\MockRoot", content: "{\"files\":[]}" });
    expect(plan.ok).toBe(true);
    expect(plan.path).toContain(".vrcsm-upload-plan.json");
    expect(plan.bytes).toBeGreaterThan(0);

    const dir = await ipc.call<
      { subdir: string; create: boolean },
      { ok: boolean; root: string; path: string; created: boolean }
    >("fs.appDataDir", {
      subdir: "plugin-data/dev.vrcsm.autouploader/avatar-roots",
      create: true,
    });
    expect(dir.ok).toBe(true);
    expect(dir.path).toContain("dev.vrcsm.autouploader");
  });

  it("mocks path.probe, hw.detect, and vector.removeEmbedding", async () => {
    const probe = await ipc.call<undefined, { baseDir: string; cacheWindowsPlayer: string }>(
      "path.probe",
    );
    expect(probe.baseDir.length).toBeGreaterThan(0);
    expect(probe.cacheWindowsPlayer).toContain("Cache-WindowsPlayer");

    const hw = await ipc.call<undefined, { cpu_name: string; gpu_name: string }>("hw.detect");
    expect(hw.cpu_name).toContain("Mock");
    expect(hw.gpu_name.length).toBeGreaterThan(0);

    const rec = await ipc.call<undefined, { report: { cpu_name: string }; recommendation: { tier: string } }>(
      "hw.recommend",
    );
    expect(rec.report.cpu_name).toBe(hw.cpu_name);
    expect(rec.recommendation.tier).toBe("ultra");

    const removed = await ipc.call<{ avatar_id: string }, { ok: boolean }>(
      "vector.removeEmbedding",
      { avatar_id: "avtr_mock" },
    );
    expect(removed.ok).toBe(true);
  });
});
