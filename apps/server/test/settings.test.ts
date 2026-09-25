import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, envDefaults, getSettings, resetSettings, ttsVoiceLabel, updateSettings, useSettingsFile } from "../src/config.js";
import { tutorAgent } from "../src/agents/tutor-agent.js";
import { assessorAgent } from "../src/agents/assessor-agent.js";

describe("runtime settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-settings-"));
  const file = path.join(dir, "settings.json");
  beforeAll(() => useSettingsFile(file));
  afterAll(() => {
    resetSettings();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts from the environment defaults", () => {
    expect(getSettings().effective).toEqual(envDefaults);
    expect(getSettings().overrides).toEqual({});
  });

  it("applies a change immediately to config and to the agent specs, and persists it", () => {
    updateSettings({ tutorModel: "claude-haiku-4-5", tutorEffort: "medium", model: "claude-sonnet-5" });
    expect(config.tutorModel).toBe("claude-haiku-4-5");
    expect(config.tutorEffort).toBe("medium");
    expect(tutorAgent.model).toBe("claude-haiku-4-5");
    expect(tutorAgent.effort).toBe("medium");
    expect(assessorAgent.model).toBe("claude-sonnet-5");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ tutorModel: "claude-haiku-4-5", tutorEffort: "medium", model: "claude-sonnet-5" });
  });

  it("rejects invalid values without changing anything", () => {
    expect(() => updateSettings({ tutorEffort: "turbo" })).toThrow();
    expect(() => updateSettings({ tutorModel: "" })).toThrow();
    expect(config.tutorEffort).toBe("medium");
  });

  it("switches the voice provider and validates the ElevenLabs settings", () => {
    updateSettings({ ttsProvider: "elevenlabs", elevenVoiceId: "abc123", elevenVoiceName: "Matilda", elevenModel: "eleven_v3_conversational", elevenStability: 0.35, elevenSpeed: 0.9 });
    expect(config.ttsProvider).toBe("elevenlabs");
    expect(config.elevenModel).toBe("eleven_v3_conversational");
    expect(ttsVoiceLabel()).toBe("Matilda");
    updateSettings({ elevenVoiceName: "" });
    expect(ttsVoiceLabel()).toBe("abc123"); // an id with no stored name still reads as something
    for (const bad of [{ ttsProvider: "cartesia" }, { elevenStability: 1.5 }, { elevenSpeed: 1.3 }, { elevenSpeed: 0.5 }, { elevenVoiceId: "" }]) {
      expect(() => updateSettings(bad)).toThrow();
    }
    updateSettings({ ttsProvider: "hume" });
    expect(ttsVoiceLabel()).toBe(config.ttsVoice);
    resetSettings();
  });

  it("drops overrides that restate the default, and reset returns to the environment", () => {
    updateSettings({ tutorEffort: envDefaults.tutorEffort });
    expect(getSettings().overrides).not.toHaveProperty("tutorEffort");
    resetSettings();
    expect(getSettings().effective).toEqual(envDefaults);
    expect(fs.existsSync(file)).toBe(false);
  });
});
