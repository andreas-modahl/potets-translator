/* The rarity of a chest badge. */

/** A badge's rarity is earned: a longer word starts higher, and every
    two more times it is typed unaided lifts it a tier. */
export const RARITIES = ['vanlig', 'sjelden', 'episk', 'legendarisk'];

export function rarityTier(word) {
  const pieces = word.pieces ?? 0;
  const count = word.count ?? 1;
  return Math.min(RARITIES.length - 1, Math.floor(pieces / 2) + Math.floor((count - 1) / 2));
}

export function rarityOf(word) {
  return RARITIES[rarityTier(word)];
}
