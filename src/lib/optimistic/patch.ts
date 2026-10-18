/**
 * Optimistic list edits: apply field patches to some rows at once, and keep what those fields
 * were so a failed save can put them back exactly.
 */
export function patchById<T extends { id: string }>(items: readonly T[], patches: ReadonlyMap<string, Partial<T>>): T[] {
  if (patches.size === 0) return [...items];
  return items.map((item) => {
    const patch = patches.get(item.id);
    return patch ? { ...item, ...patch } : item;
  });
}

/** The current values of `keys` for the rows in `ids`: the patch that reverts an optimistic edit. */
export function snapshotFields<T extends { id: string }, K extends keyof T>(
  items: readonly T[],
  ids: Iterable<string>,
  keys: readonly K[],
): Map<string, Pick<T, K>> {
  const wanted = new Set(ids);
  const snapshot = new Map<string, Pick<T, K>>();
  for (const item of items) {
    if (!wanted.has(item.id)) continue;
    const fields = {} as Pick<T, K>;
    for (const key of keys) fields[key] = item[key];
    snapshot.set(item.id, fields);
  }
  return snapshot;
}

/**
 * Reverts only rows still showing the optimistic value: if a later change touched a row since,
 * that newer change wins and the failed one is simply dropped.
 */
export function revertPatches<T extends { id: string }, K extends keyof T>(
  items: readonly T[],
  applied: ReadonlyMap<string, Pick<T, K>>,
  previous: ReadonlyMap<string, Pick<T, K>>,
): T[] {
  return items.map((item) => {
    const optimistic = applied.get(item.id);
    const before = previous.get(item.id);
    if (!optimistic || !before) return item;
    const untouched = (Object.keys(optimistic) as K[]).every((key) => Object.is(item[key], optimistic[key]));
    return untouched ? { ...item, ...before } : item;
  });
}
