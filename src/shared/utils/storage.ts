export function getStorageItemWithFallback(
  storage: Pick<Storage, "getItem">,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function migrateStorageValue(
  storage: Pick<Storage, "getItem" | "setItem">,
  currentKey: string,
  legacyKeys: readonly string[]
): string | null {
  const currentValue = storage.getItem(currentKey);
  if (currentValue !== null) {
    return currentValue;
  }

  const legacyValue = getStorageItemWithFallback(storage, legacyKeys);
  if (legacyValue !== null) {
    storage.setItem(currentKey, legacyValue);
  }

  return legacyValue;
}
