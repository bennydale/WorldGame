# WorldGame

WorldGame is a Phaser 4 + TypeScript terrain viewer built from the original canvas Perlin-noise prototype. The terrain is generated once as a deterministic top-level world map, rendered as a culled Phaser tilemap with the original 8×8 terrain artwork, and explored with a Phaser camera.

The interactive map is intentionally a 240×180 overview LOD. It samples the complete 1280×960 legacy coordinate domain with the original five-layer elevation equation and terrain bands, while keeping startup and camera movement responsive. It is a top-level overview rather than a cell-for-cell 1.2-million-tile render.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:8080/demo.html` or the machine's LAN address on port 8080.

Production checks and output:

```bash
npm run check
npm run build
npm run preview
```

Both `index.html` and `demo.html` are production entry points and are emitted to `dist/`.

## Controls

- Mouse wheel: immediate, discrete zoom steps.
- Left-drag: pan the world map.
- Arrow keys or WASD: pan the world map.

Zoom always anchors to the center of the viewport. The scene records the world-space center, changes the Phaser camera zoom by one indexed step, then explicitly re-centers on the recorded point. It never rebuilds the Perlin map or anchors to the pointer/top-left corner.

## Structure

- `src/noise/PerlinNoise.ts` — seeded, typed 2D improved Perlin noise.
- `src/terrain/TerrainGenerator.ts` — the legacy five-layer ridged formula, ordered terrain bands, and compact tile-index generation.
- `src/game/WorldScene.ts` — Phaser tilemap, camera, discrete zoom, pan controls, HUD, and diagnostics.
- `src/game/main.ts` — Phaser game configuration.
- `src/main.ts` — browser bootstrap and hot-reload cleanup.
- `public/assets/` — all original terrain, plant, tree, sprite, concept, and audio artwork, retained and copied into production builds.

For interactive verification, the running scene publishes read-only diagnostics at `window.__WORLDGAME_DEBUG__`.
