import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTtsSupported, speak } from "../tts";

// The pure, side-effecting surface of the TTS module. The pipeline-wiring hook
// (useTtsAnnounce) is exercised indirectly by the pages smoke test mounting the
// app shell; here we pin the speak()/support guards which carry the real logic.

describe("tts isTtsSupported", () => {
  const orig = (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  afterEach(() => {
    if (orig === undefined) delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    else (globalThis as { speechSynthesis?: unknown }).speechSynthesis = orig;
    vi.unstubAllGlobals();
  });

  it("is false when the API is absent", () => {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    expect(isTtsSupported()).toBe(false);
  });

  it("is true when speechSynthesis exists", () => {
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    expect(isTtsSupported()).toBe(true);
  });
});

describe("tts speak", () => {
  let speakSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speakSpy = vi.fn();
    cancelSpy = vi.fn();
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = {
      speak: speakSpy,
      cancel: cancelSpy,
    };
    // jsdom lacks the constructor; stub a minimal one that records its text.
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        lang = "";
        constructor(t: string) {
          this.text = t;
        }
      },
    );
  });

  afterEach(() => {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    vi.unstubAllGlobals();
  });

  it("cancels in-flight speech then speaks the latest phrase", () => {
    speak("hello world", "en-US");
    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(speakSpy).toHaveBeenCalledOnce();
    const utter = speakSpy.mock.calls[0][0] as { text: string; lang: string };
    expect(utter.text).toBe("hello world");
    expect(utter.lang).toBe("en-US");
  });

  it("no-ops on empty text", () => {
    speak("");
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it("swallows synth errors instead of throwing", () => {
    speakSpy.mockImplementation(() => {
      throw new Error("synth boom");
    });
    expect(() => speak("boom")).not.toThrow();
  });
});
