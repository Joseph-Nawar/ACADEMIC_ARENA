// The BFF validates Character V2 configs with the same trusted catalogue the
// studio uses (assets/avatar-v2/catalog.js). The database re-checks shape and
// ownership at its write boundary; this layer rejects bad input early and
// re-validates everything the database returns before it reaches a browser.
import "../../assets/avatar-v2/catalog.js";

export const catalog = globalThis.AcademicArenaAvatarCatalog;
const COLLECTIONS = new Set(Object.keys(catalog.collections));

export function ownedItemsFor(collections) {
  const owned = new Set();
  for (const name of collections) {
    if (!COLLECTIONS.has(name)) continue;
    for (const key of Object.keys(catalog.items)) if (catalog.items[key].collection === name) owned.add(key);
  }
  return owned;
}

// Shape and catalogue only (ownership is the database's decision on save).
export function validShape(config) {
  const allItems = new Set(Object.keys(catalog.items));
  const result = catalog.validateConfig(config, { ownedItems: allItems });
  return result.ok ? result.config : null;
}

// For configs read back from the database: valid and owned, or nothing.
export function publicConfig(config, collections = Object.keys(catalog.collections)) {
  const result = catalog.validateConfig(config, { ownedItems: ownedItemsFor(collections) });
  return result.ok ? result.config : null;
}

export function lockedItems(config, collections) {
  const result = catalog.validateConfig(config, { ownedItems: ownedItemsFor(collections) });
  return result.errors.filter((error) => error.code === "not_owned").map((error) => error.item);
}

export function ownedCollections(value) {
  return Array.isArray(value) ? value.filter((name) => typeof name === "string" && COLLECTIONS.has(name)) : ["essentials"];
}
