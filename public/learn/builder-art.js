/* How the word builder draws a word: as a staircase of steps, or as a
   thing that grows a part per ending. The root is the front, each ending
   a part hitched on behind, so the shape of the word is the shape of the
   thing. */

export const BUILDER_VIEWS = ['stairs', 'rocket', 'train', 'worm'];
export const BUILDER_ICONS = { stairs: '🪜', rocket: '🚀', train: '🚂', worm: '🐛' };

/* The drawn parts: what goes in front of the root, and what trails the last
   ending. Each is sized to the row of parts it joins. */
export const BUILDER_ART = {
  rocket: {
    head:
      '<svg class="part-art nose" viewBox="0 0 40 40" aria-hidden="true">' +
      '<path d="M40 1 Q 12 6 2 20 Q 12 34 40 39 Z" />' +
      '<circle cx="27" cy="20" r="5" class="window" />' +
      '</svg>',
    tail:
      '<svg class="part-art flame" viewBox="0 -12 72 64" aria-hidden="true">' +
      '<path d="M0 1 L22 1 Q 8 -8 0 -18 Z" /><path d="M0 39 L22 39 Q 8 48 0 58 Z" />' +
      '<path class="fire" d="M6 9 Q 44 4 70 20 Q 44 36 6 31 Z" />' +
      '<path class="fire-core" d="M6 14 Q 30 12 46 20 Q 30 28 6 26 Z" />' +
      '</svg>',
  },
  train: {
    head:
      '<svg class="part-art engine" viewBox="0 -18 52 60" aria-hidden="true">' +
      '<path class="smoke" d="M12 -6 a5 5 0 1 1 0.1 0" /><path class="smoke" d="M20 -14 a4 4 0 1 1 0.1 0" />' +
      '<rect x="8" y="-2" width="10" height="12" />' +
      '<path d="M4 10 H52 V40 H10 L2 30 Z" />' +
      '<circle cx="18" cy="42" r="6" class="wheel" /><circle cx="40" cy="42" r="6" class="wheel" />' +
      '</svg>',
    tail: '',
  },
  worm: {
    head:
      '<svg class="part-art face" viewBox="0 -14 46 56" aria-hidden="true">' +
      '<path class="feeler" d="M18 2 Q 12 -10 4 -12" /><path class="feeler" d="M28 2 Q 32 -10 40 -13" />' +
      '<circle cx="4" cy="-12" r="2.5" /><circle cx="40" cy="-13" r="2.5" />' +
      '<circle cx="23" cy="21" r="21" />' +
      '<circle cx="16" cy="16" r="3" class="eye" /><circle cx="30" cy="16" r="3" class="eye" />' +
      '<path class="smile" d="M14 27 Q 23 35 32 27" />' +
      '</svg>',
    tail:
      '<svg class="part-art rump" viewBox="0 0 24 42" aria-hidden="true">' +
      '<path d="M0 6 Q 22 8 22 21 Q 22 34 0 36 Z" />' +
      '</svg>',
  },
};
