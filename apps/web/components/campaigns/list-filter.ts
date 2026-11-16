/**
 * The lists whose name contains every word typed, in any case and any order (D4-20). A blank
 * search keeps every list.
 */
export function filterListsByName<T extends { name: string }>(
  lists: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...lists];
  return lists.filter((list) => {
    const name = list.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
}
