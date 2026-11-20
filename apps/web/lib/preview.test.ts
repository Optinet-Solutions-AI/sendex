import { describe, expect, it } from "vitest";
import { parsePreviewView, previewState, previewViewCookie } from "./preview";

describe("previewState (D5-11)", () => {
  it("is off, with no toggle, for an organisation without either switch", () => {
    expect(previewState({ previewFeatures: false, previewToggle: false }, "new")).toEqual({
      previewFeatures: false,
      previewView: null,
    });
  });

  it("is always on, with no toggle, for an organisation with the preview switched on", () => {
    for (const cookie of [undefined, "existing", "new"]) {
      expect(previewState({ previewFeatures: true, previewToggle: true }, cookie)).toEqual({
        previewFeatures: true,
        previewView: null,
      });
    }
  });

  it("starts on Existing for an organisation with the toggle", () => {
    expect(previewState({ previewFeatures: false, previewToggle: true }, undefined)).toEqual({
      previewFeatures: false,
      previewView: "existing",
    });
  });

  it("shows the new screens once the person picks New", () => {
    expect(previewState({ previewFeatures: false, previewToggle: true }, "new")).toEqual({
      previewFeatures: true,
      previewView: "new",
    });
  });

  it("reads anything else in the cookie as Existing", () => {
    for (const cookie of ["", "NEW", "yes", "existing"]) {
      expect(
        previewState({ previewFeatures: false, previewToggle: true }, cookie).previewView,
      ).toBe("existing");
    }
  });
});

describe("previewViewCookie and parsePreviewView", () => {
  it("keeps the choice per organisation", () => {
    expect(previewViewCookie("org-1")).not.toBe(previewViewCookie("org-2"));
    expect(previewViewCookie("org-1")).toMatch(/^sendex-view-/);
  });

  it("accepts only Existing or New", () => {
    expect(parsePreviewView("new")).toBe("new");
    expect(parsePreviewView("existing")).toBe("existing");
    expect(() => parsePreviewView("both")).toThrow();
  });
});
