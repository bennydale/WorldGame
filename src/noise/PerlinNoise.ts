/*
 * Typed 2D port of the improved Perlin implementation that shipped with
 * WorldGame. It is derived from Joseph Gentle's JavaScript port of work by
 * Stefan Gustavson and Peter Eastman, under the repository's ISC license.
 */

type Gradient2D = readonly [x: number, y: number];

const GRADIENTS: readonly Gradient2D[] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1]
];

const BASE_PERMUTATION = new Uint8Array([
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3,
  64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85,
  212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170,
  213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43,
  172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185,
  112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191,
  179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31,
  181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150,
  254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195,
  78, 66, 215, 61, 156, 180
]);

const fade = (value: number): number => {
  return value * value * value * (value * (value * 6 - 15) + 10);
};

const lerp = (start: number, end: number, amount: number): number => {
  return (1 - amount) * start + amount * end;
};

const dot = (gradient: Gradient2D, x: number, y: number): number => {
  return gradient[0] * x + gradient[1] * y;
};

export class PerlinNoise {
  private readonly permutation = new Uint16Array(512);
  private readonly gradientIndex = new Uint8Array(512);

  constructor(seed = 0) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    let normalizedSeed = Number.isFinite(seed) ? seed : 0;

    if (normalizedSeed > 0 && normalizedSeed < 1) {
      normalizedSeed *= 65536;
    }

    let integerSeed = Math.floor(normalizedSeed);

    if (integerSeed < 256) {
      integerSeed |= integerSeed << 8;
    }

    for (let index = 0; index < 256; index += 1) {
      const seedByte = index & 1 ? integerSeed & 255 : (integerSeed >> 8) & 255;
      const value = BASE_PERMUTATION[index] ^ seedByte;

      this.permutation[index] = value;
      this.permutation[index + 256] = value;
      this.gradientIndex[index] = value % GRADIENTS.length;
      this.gradientIndex[index + 256] = value % GRADIENTS.length;
    }
  }

  sample2D(x: number, y: number): number {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const localX = x - cellX;
    const localY = y - cellY;
    const wrappedX = cellX & 255;
    const wrappedY = cellY & 255;

    const gradient00 = GRADIENTS[this.gradientIndex[wrappedX + this.permutation[wrappedY]]];
    const gradient01 = GRADIENTS[this.gradientIndex[wrappedX + this.permutation[wrappedY + 1]]];
    const gradient10 = GRADIENTS[this.gradientIndex[wrappedX + 1 + this.permutation[wrappedY]]];
    const gradient11 = GRADIENTS[this.gradientIndex[wrappedX + 1 + this.permutation[wrappedY + 1]]];

    const xFade = fade(localX);
    const yFade = fade(localY);
    const top = lerp(dot(gradient00, localX, localY), dot(gradient10, localX - 1, localY), xFade);
    const bottom = lerp(dot(gradient01, localX, localY - 1), dot(gradient11, localX - 1, localY - 1), xFade);

    return lerp(top, bottom, yFade);
  }
}
