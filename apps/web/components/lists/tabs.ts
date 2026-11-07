/** Tab names of list details, shared by the server page (URL parsing) and the client tabs. */

export const LIST_TAB_VALUES = ["contacts", "analytics", "files", "campaigns", "lookup"] as const;
export type ListTab = (typeof LIST_TAB_VALUES)[number];

export function isListTab(value: string | null): value is ListTab {
  return (LIST_TAB_VALUES as readonly string[]).includes(value ?? "");
}
