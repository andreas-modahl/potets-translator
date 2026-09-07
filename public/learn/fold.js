/* Spelling compared loosely: what counts as the same word when typed. */

/** Letters folded to their plain Latin base, in either language, so ş
    and s, ı and i, ğ and g, ö and o, ü and u, ç and c, æ and a, ø and
    o, å and a all count the same. Both the typed word and the answer go
    through this: the point is the word and its order, not the keyboard. */
export function fold(text) {
  return text
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/æ/g, 'a')
    .replace(/ø/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // The way å, ø and æ are typed on a keyboard without them. Applied to
    // the answer too, so a word that really has "oe" (poeng) still matches.
    .replace(/aa/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ae/g, 'a')
    .replace(/[’'`´]/g, '')
    // Punctuation the model left glued to a word is not part of the
    // spelling, and the full stop is the hint key besides.
    .replace(/[.,;:!?…]/g, '')
    .replace(/\s+/g, ' ');
}

export function sameWord(typed, answer) {
  return fold(typed) === fold(answer);
}

/** An ending the way it is written on a heading, folded so that "-ecek" finds
    "eceğ", "-ir" finds "er" and "-de" finds "ta": vowels alike, the consonants
    that harden or soften folded together, dashes and case gone. */
export function hintFold(text) {
  return text
    .toLocaleLowerCase('tr')
    .replace(/^-+/, '')
    .replace(/ğ/g, 'k')
    .replace(/t/g, 'd')
    .replace(/ç/g, 'c')
    .replace(/[aeıioöuüâîû]/g, '*');
}
