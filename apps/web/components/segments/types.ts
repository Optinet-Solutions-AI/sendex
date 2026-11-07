import type { SegmentGroup } from "@sendex/core";

/** Choices for the enum fields of the builder, loaded by the page. */
export interface SegmentChoices {
  countries: Array<{ value: string; label: string }>;
  lists: Array<{ value: string; label: string }>;
  campaigns: Array<{ value: string; label: string }>;
  devices: Array<{ value: string; label: string }>;
  networks: Array<{ value: string; label: string }>;
}

export interface SegmentView {
  id: string;
  name: string;
  summary: string;
  definition: SegmentGroup;
  isTemplate: boolean;
  globalExclude: boolean;
  size: number | null;
  good: number | null;
  statsAt: string | null;
  createdAt: string;
}

export interface SegmentPreviewView {
  total: number;
  good: number;
  cached: number;
  sample: string[];
  countries: Array<{ key: string; count: number }>;
  networks: Array<{ key: string; count: number }>;
  devices: Array<{ key: string; count: number }>;
}
