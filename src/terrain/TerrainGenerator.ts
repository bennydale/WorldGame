import { PerlinNoise } from '../noise/PerlinNoise';

export const TERRAIN_MAP_WIDTH = 240;
export const TERRAIN_MAP_HEIGHT = 180;
export const TERRAIN_TILE_SIZE = 8;
export const TERRAIN_WORLD_WIDTH = TERRAIN_MAP_WIDTH * TERRAIN_TILE_SIZE;
export const TERRAIN_WORLD_HEIGHT = TERRAIN_MAP_HEIGHT * TERRAIN_TILE_SIZE;

const LEGACY_MAP_WIDTH = 1280;
const LEGACY_MAP_HEIGHT = 960;
const LEGACY_NOISE_SCALE = 8;

export interface TerrainBand {
  id: string;
  label: string;
  upperBound: number;
  textureKey: string;
  assetPath: string;
}

export interface GeneratedTerrain {
  width: number;
  height: number;
  tileIndices: Uint8Array;
  elevationMin: number;
  elevationMax: number;
  terrainCounts: Record<string, number>;
}

export const TERRAIN_BANDS: readonly TerrainBand[] = [
  { id: 'deepest-water', label: 'Deepest water', upperBound: 24, textureKey: 'terrain-deepest-water', assetPath: 'assets/textures/Background/DeepestWater.png' },
  { id: 'deep-water', label: 'Deep water', upperBound: 50, textureKey: 'terrain-deep-water', assetPath: 'assets/textures/Background/DeepWater.png' },
  { id: 'medium-water', label: 'Medium water', upperBound: 65, textureKey: 'terrain-medium-water', assetPath: 'assets/textures/Background/MediumWater.png' },
  { id: 'shallow-water', label: 'Shallow water', upperBound: 85, textureKey: 'terrain-shallow-water', assetPath: 'assets/textures/Background/ShallowWater.png' },
  { id: 'sand', label: 'Sand', upperBound: 100, textureKey: 'terrain-sand', assetPath: 'assets/textures/Background/Sand.png' },
  { id: 'grass', label: 'Grass', upperBound: 160, textureKey: 'terrain-grass', assetPath: 'assets/textures/Background/Grass.png' },
  { id: 'mountain-extra-low', label: 'Foothills', upperBound: 170, textureKey: 'terrain-mountain-extra-low', assetPath: 'assets/textures/Background/MountainExtraLow.png' },
  { id: 'mountain-low', label: 'Low mountain', upperBound: 185, textureKey: 'terrain-mountain-low', assetPath: 'assets/textures/Background/MountainLow.png' },
  { id: 'mountain-medium', label: 'Medium mountain', upperBound: 200, textureKey: 'terrain-mountain-medium', assetPath: 'assets/textures/Background/MountainMed.png' },
  { id: 'mountain-high', label: 'High mountain', upperBound: 230, textureKey: 'terrain-mountain-high', assetPath: 'assets/textures/Background/MountainHigh.png' },
  { id: 'mountain-snow', label: 'Snow', upperBound: Number.POSITIVE_INFINITY, textureKey: 'terrain-mountain-snow', assetPath: 'assets/textures/Background/MountainSnow.png' }
];

const classifyTerrain = (elevation: number): number => {
  const index = TERRAIN_BANDS.findIndex((band) => elevation < band.upperBound);
  return index === -1 ? TERRAIN_BANDS.length - 1 : index;
};

export class TerrainGenerator {
  constructor(private readonly noise: PerlinNoise) {}

  generate(
    width = TERRAIN_MAP_WIDTH,
    height = TERRAIN_MAP_HEIGHT
  ): GeneratedTerrain {
    const tileIndices = new Uint8Array(width * height);
    const terrainCounts = Object.fromEntries(TERRAIN_BANDS.map((band) => [band.id, 0]));
    let elevationMin = Number.POSITIVE_INFINITY;
    let elevationMax = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < height; y += 1) {
      const legacyY = y * (LEGACY_MAP_HEIGHT / height);

      for (let x = 0; x < width; x += 1) {
        const legacyX = x * (LEGACY_MAP_WIDTH / width);
        const elevation = this.sampleLegacyElevation(legacyX, legacyY);
        const bandIndex = classifyTerrain(elevation);
        const band = TERRAIN_BANDS[bandIndex];
        tileIndices[x + y * width] = bandIndex;

        terrainCounts[band.id] += 1;
        elevationMin = Math.min(elevationMin, elevation);
        elevationMax = Math.max(elevationMax, elevation);
      }
    }

    return {
      width,
      height,
      tileIndices,
      elevationMin,
      elevationMax,
      terrainCounts
    };
  }

  private sampleLegacyElevation(x: number, y: number): number {
    const ridgedSample = (divisor: number, amplitude: number): number => {
      const sampleX = (x / divisor) * LEGACY_NOISE_SCALE;
      const sampleY = (y / divisor) * LEGACY_NOISE_SCALE;
      return Math.abs(this.noise.sample2D(sampleX, sampleY)) * amplitude;
    };

    // This is the original WorldGame five-layer equation, made explicit:
    // 480|P/2800| - 76|P/100| + 50|P/25| - 25|P/10| + 20|P/5|.
    return (
      ridgedSample(2800, 480)
      - ridgedSample(100, 76)
      + ridgedSample(25, 50)
      - ridgedSample(10, 25)
      + ridgedSample(5, 20)
    );
  }
}
