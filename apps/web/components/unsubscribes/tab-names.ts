/** Tab names of the Unsubscribe page, shared by the server page (URL parsing) and the client tabs. */

export const UNSUBSCRIBE_TAB_VALUES = ["numbers", "imports", "api"] as const;
export type UnsubscribeTab = (typeof UNSUBSCRIBE_TAB_VALUES)[number];

export function isUnsubscribeTab(value: string | null): value is UnsubscribeTab {
  return (UNSUBSCRIBE_TAB_VALUES as readonly string[]).includes(value ?? "");
}
