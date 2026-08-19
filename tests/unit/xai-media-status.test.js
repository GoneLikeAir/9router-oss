import { describe, it, expect } from "vitest";
import { resolveXaiMediaDetailView, summarizeXaiMediaCard } from "@/app/(dashboard)/dashboard/media-providers/[kind]/xaiMediaStatus.js";

const xaiActive = { id: "x1", provider: "xai", isActive: true, testStatus: "active" };
const xaiDisabled = { id: "x2", provider: "xai", isActive: false, testStatus: "active" };
const grokReady = {
  id: "g1",
  provider: "grok-cli",
  isActive: true,
  authType: "oauth",
  providerSpecificData: { subscriptionTier: "super_grok" },
};
const grokFree = {
  id: "g2",
  provider: "grok-cli",
  isActive: true,
  authType: "oauth",
  providerSpecificData: { subscriptionTier: "free" },
};

describe("summarizeXaiMediaCard", () => {
  it("shows Ready + Uses Grok Build login when only grok-cli is present", () => {
    const s = summarizeXaiMediaCard({ xaiConnections: [], grokCliConnections: [grokReady] });
    expect(s.badge).toBe("ready-borrowed");
    expect(s.subtitle).toBe("Uses Grok Build login");
    expect(s.showToggle).toBe(false);
    expect(s.xaiConnectedCount).toBe(0);
  });

  it("counts only real xai connections and adds Also uses", () => {
    const s = summarizeXaiMediaCard({
      xaiConnections: [xaiActive],
      grokCliConnections: [grokReady],
    });
    expect(s.badge).toBe("connected");
    expect(s.xaiConnectedCount).toBe(1);
    expect(s.subtitle).toBe("Also uses Grok Build login");
    expect(s.showToggle).toBe(true);
  });

  it("marks Free / X Basic borrow as restricted, not Ready", () => {
    const s = summarizeXaiMediaCard({ xaiConnections: [], grokCliConnections: [grokFree] });
    expect(s.badge).toBe("restricted");
    expect(s.showToggle).toBe(false);
  });

  it("stays Ready when xai is disabled but grok-cli is usable", () => {
    const s = summarizeXaiMediaCard({
      xaiConnections: [xaiDisabled],
      grokCliConnections: [grokReady],
    });
    expect(s.badge).toBe("ready-borrowed");
    expect(s.dimmed).toBe(false);
    expect(s.showToggle).toBe(true);
  });

  it("shows none when nobody is logged in", () => {
    const s = summarizeXaiMediaCard({ xaiConnections: [], grokCliConnections: [] });
    expect(s.badge).toBe("none");
    expect(s.showToggle).toBe(false);
  });
});

describe("resolveXaiMediaDetailView", () => {
  it("does not enter empty state while loading", () => {
    const v = resolveXaiMediaDetailView({ loaded: false, error: null, hasXaiNative: false, hasBorrowed: false });
    expect(v.phase).toBe("loading");
    expect(v.showEmpty).toBe(false);
  });

  it("does not treat a failed accounts fetch as empty", () => {
    const v = resolveXaiMediaDetailView({
      loaded: true,
      error: "HTTP 500",
      hasXaiNative: false,
      hasBorrowed: false,
    });
    expect(v.phase).toBe("error");
    expect(v.showEmpty).toBe(false);
    expect(v.showConnectionsCard).toBe(true);
    expect(v.showError).toBe(true);
  });

  it("keeps borrowed accounts visible after a later fetch error", () => {
    const v = resolveXaiMediaDetailView({
      loaded: true,
      error: "network",
      hasXaiNative: false,
      hasBorrowed: true,
    });
    expect(v.showEmpty).toBe(false);
    expect(v.showBorrowed).toBe(true);
    expect(v.showConnectionsCard).toBe(true);
  });
});
