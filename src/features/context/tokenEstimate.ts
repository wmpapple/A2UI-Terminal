export const estimateContextTokens = (content: string): number => {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of content) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii * 2;
};
