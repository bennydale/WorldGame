import { Input, Math as PhaserMath, Scene, Scenes, Textures, WEBGL } from 'phaser';
import { PerlinNoise } from '../noise/PerlinNoise';
import {
  GeneratedTerrain,
  TERRAIN_BANDS,
  TERRAIN_TILE_SIZE,
  TERRAIN_WORLD_HEIGHT,
  TERRAIN_WORLD_WIDTH,
  TerrainGenerator
} from '../terrain/TerrainGenerator';
import { setWorldGameDebugState } from './debug';

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const TERRAIN_DETAIL_TEXTURE_KEY = 'world-terrain-tiles';
const TERRAIN_OVERVIEW_TEXTURE_KEY = 'world-terrain-overview';
const TERRAIN_OVERVIEW_ZOOM_THRESHOLD = 1;
const PAN_SPEED = 540;
const WHEEL_STEP_COOLDOWN_MS = 110;
const PAN_STATUS_INTERVAL_MS = 50;

type TerrainLod = 'detail' | 'overview';

interface TerrainColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface MovementKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

interface DragState {
  active: boolean;
  x: number;
  y: number;
}

export class WorldScene extends Scene {
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private movementKeys?: MovementKeys;
  private terrain!: GeneratedTerrain;
  private terrainDetailLayer!: Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer;
  private terrainOverview!: Phaser.GameObjects.Image;
  private terrainLod: TerrainLod = 'detail';
  private seed = 0;
  private generationMs = 0;
  private zoomIndex = 0;
  private lastWheelAt = Number.NEGATIVE_INFINITY;
  private lastWheelDeltaY: number | null = null;
  private lastCenterDrift = 0;
  private wheelEvents = 0;
  private acceptedZoomSteps = 0;
  private lastPanStatusAt = Number.NEGATIVE_INFINITY;
  private zoomValue: HTMLElement | null = null;
  private zoomStep: HTMLElement | null = null;
  private centerValue: HTMLElement | null = null;
  private status: HTMLOutputElement | null = null;
  private readonly dragState: DragState = { active: false, x: 0, y: 0 };
  private readonly handleWindowBlur = (): void => this.handlePointerUp();

  constructor() {
    super('WorldMap');
  }

  preload(): void {
    for (const band of TERRAIN_BANDS) {
      this.load.image(band.textureKey, band.assetPath); 
    }
  }

  create(): void {
    this.seed = this.readSeed();

    const generationStartedAt = performance.now();
    this.terrain = new TerrainGenerator(new PerlinNoise(this.seed)).generate();
    this.generationMs = performance.now() - generationStartedAt;

    this.createTerrainLayer();

    this.camera = this.cameras.main;
    this.camera
      .setBackgroundColor('#07131a')
      .setBounds(0, 0, TERRAIN_WORLD_WIDTH, TERRAIN_WORLD_HEIGHT, true)
      .setRoundPixels(true)
      .setZoom(ZOOM_LEVELS[this.zoomIndex])
      .centerOn(TERRAIN_WORLD_WIDTH / 2, TERRAIN_WORLD_HEIGHT / 2);
    this.applyTerrainLod(ZOOM_LEVELS[this.zoomIndex]);
    this.camera.preRender();

    this.cacheHudElements();
    this.configureKeyboard();
    this.configurePointerInput();
    this.publishState('ready');

    document.documentElement.dataset.worldgameState = 'ready';
    window.dispatchEvent(new CustomEvent('worldgame-ready'));
  }

  update(_time: number, delta: number): void {
    const horizontal = Number(this.isRightDown()) - Number(this.isLeftDown());
    const vertical = Number(this.isDownDown()) - Number(this.isUpDown());

    if (horizontal === 0 && vertical === 0) {
      return;
    }

    const direction = new PhaserMath.Vector2(horizontal, vertical).normalize();
    const distance = (PAN_SPEED * (delta / 1000)) / this.camera.zoom;

    this.camera.scrollX += direction.x * distance;
    this.camera.scrollY += direction.y * distance;
    this.refreshCameraBounds();
    this.publishPanState('keyboard-pan');
  }

  private createTerrainLayer(): void {
    const texture = this.textures.createCanvas(
      TERRAIN_DETAIL_TEXTURE_KEY,
      TERRAIN_TILE_SIZE * TERRAIN_BANDS.length,
      TERRAIN_TILE_SIZE
    );

    if (!texture) {
      throw new Error('Unable to allocate the WorldGame terrain tileset.');
    }

    const context = texture.getContext();
    context.imageSmoothingEnabled = false;

    TERRAIN_BANDS.forEach((band, index) => {
      const frame = this.textures.getFrame(band.textureKey);

      if (!frame) {
        throw new Error(`Missing terrain artwork: ${band.assetPath}`);
      }

      context.drawImage(
        frame.source.image as CanvasImageSource,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        index * TERRAIN_TILE_SIZE,
        0,
        TERRAIN_TILE_SIZE,
        TERRAIN_TILE_SIZE
      );
    });

    texture.refresh();
    texture.setFilter(Textures.FilterMode.NEAREST);

    const averageColors = this.calculateAverageTerrainColors(context);
    this.createTerrainOverview(averageColors);

    const rows = Array.from({ length: this.terrain.height }, (_, y) => {
      const rowStart = y * this.terrain.width;
      return Array.from(this.terrain.tileIndices.subarray(rowStart, rowStart + this.terrain.width));
    });
    const tilemap = this.make.tilemap({
      data: rows,
      tileWidth: TERRAIN_TILE_SIZE,
      tileHeight: TERRAIN_TILE_SIZE
    });
    const tileset = tilemap.addTilesetImage(
      'world-terrain',
      TERRAIN_DETAIL_TEXTURE_KEY,
      TERRAIN_TILE_SIZE,
      TERRAIN_TILE_SIZE,
      0,
      0,
      0
    );

    if (!tileset) {
      throw new Error('Unable to create the WorldGame Phaser tileset.');
    }

    const detailLayer = tilemap.createLayer(0, tileset, 0, 0);

    if (!detailLayer) {
      throw new Error('Unable to create the WorldGame terrain layer.');
    }

    this.terrainDetailLayer = detailLayer;
  }

  private calculateAverageTerrainColors(context: CanvasRenderingContext2D): TerrainColor[] {
    return TERRAIN_BANDS.map((_band, bandIndex) => {
      const pixels = context.getImageData(
        bandIndex * TERRAIN_TILE_SIZE,
        0,
        TERRAIN_TILE_SIZE,
        TERRAIN_TILE_SIZE
      ).data;
      const pixelCount = pixels.length / 4;
      let weightedRed = 0;
      let weightedGreen = 0;
      let weightedBlue = 0;
      let alphaTotal = 0;

      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3];
        weightedRed += pixels[offset] * alpha;
        weightedGreen += pixels[offset + 1] * alpha;
        weightedBlue += pixels[offset + 2] * alpha;
        alphaTotal += alpha;
      }

      if (alphaTotal === 0) {
        return { red: 0, green: 0, blue: 0, alpha: 0 };
      }

      return {
        red: Math.round(weightedRed / alphaTotal),
        green: Math.round(weightedGreen / alphaTotal),
        blue: Math.round(weightedBlue / alphaTotal),
        alpha: Math.round(alphaTotal / pixelCount)
      };
    });
  }

  private createTerrainOverview(averageColors: readonly TerrainColor[]): void {
    const texture = this.textures.createCanvas(
      TERRAIN_OVERVIEW_TEXTURE_KEY,
      this.terrain.width,
      this.terrain.height
    );

    if (!texture) {
      throw new Error('Unable to allocate the WorldGame terrain overview.');
    }

    const context = texture.getContext();
    const imageData = context.createImageData(this.terrain.width, this.terrain.height);

    for (let tileOffset = 0; tileOffset < this.terrain.tileIndices.length; tileOffset += 1) {
      const color = averageColors[this.terrain.tileIndices[tileOffset]];
      const pixelOffset = tileOffset * 4;
      imageData.data[pixelOffset] = color.red;
      imageData.data[pixelOffset + 1] = color.green;
      imageData.data[pixelOffset + 2] = color.blue;
      imageData.data[pixelOffset + 3] = color.alpha;
    }

    context.putImageData(imageData, 0, 0);
    texture.refresh();
    texture.setFilter(Textures.FilterMode.NEAREST);

    this.terrainOverview = this.add
      .image(0, 0, TERRAIN_OVERVIEW_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setScale(TERRAIN_TILE_SIZE);
  }

  private applyTerrainLod(zoom: number): void {
    const useOverview = zoom < TERRAIN_OVERVIEW_ZOOM_THRESHOLD;
    this.terrainLod = useOverview ? 'overview' : 'detail';
    this.terrainOverview.setVisible(useOverview);
    this.terrainDetailLayer.setVisible(!useOverview);
  }

  private configureKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    this.cursors = keyboard.createCursorKeys();
    this.movementKeys = keyboard.addKeys({
      up: Input.Keyboard.KeyCodes.W,
      down: Input.Keyboard.KeyCodes.S,
      left: Input.Keyboard.KeyCodes.A,
      right: Input.Keyboard.KeyCodes.D
    }) as MovementKeys;
  }

  private configurePointerInput(): void {
    this.input.on(Input.Events.POINTER_WHEEL, this.handleWheel, this);
    this.input.on(Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.input.on(Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.input.on(Input.Events.POINTER_UP, this.handlePointerUp, this);
    this.input.on(Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    this.input.on(Input.Events.GAME_OUT, this.handlePointerUp, this);
    window.addEventListener('blur', this.handleWindowBlur);

    this.events.once(Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.handleWindowBlur);
      this.dragState.active = false;
      document.body.classList.remove('is-dragging');
    });
  }

  private handleWheel(
    _pointer: Phaser.Input.Pointer,
    _currentlyOver: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number
  ): void {
    this.wheelEvents += 1;
    this.lastWheelDeltaY = deltaY;

    if (deltaY === 0) {
      this.publishState('wheel-ignored', false);
      return;
    }

    const now = this.time.now;

    if (now - this.lastWheelAt < WHEEL_STEP_COOLDOWN_MS) {
      this.publishState('wheel-throttled', false);
      return;
    }

    this.lastWheelAt = now;
    this.stepZoom(deltaY < 0 ? 1 : -1);
  }

  private stepZoom(direction: -1 | 1): void {
    const nextIndex = PhaserMath.Clamp(this.zoomIndex + direction, 0, ZOOM_LEVELS.length - 1);

    if (nextIndex === this.zoomIndex) {
      this.publishState(direction > 0 ? 'wheel-maximum' : 'wheel-minimum');
      return;
    }

    const centerBeforeX = this.camera.midPoint.x;
    const centerBeforeY = this.camera.midPoint.y;

    this.zoomIndex = nextIndex;
    const zoom = ZOOM_LEVELS[this.zoomIndex];
    this.camera.setZoom(zoom);
    this.applyTerrainLod(zoom);
    this.camera.centerOn(centerBeforeX, centerBeforeY);
    this.camera.preRender();

    const centerAfterX = this.camera.midPoint.x;
    const centerAfterY = this.camera.midPoint.y;
    this.lastCenterDrift = PhaserMath.Distance.Between(
      centerBeforeX,
      centerBeforeY,
      centerAfterX,
      centerAfterY
    );
    this.acceptedZoomSteps += 1;
    this.publishState(direction > 0 ? 'wheel-zoom-in' : 'wheel-zoom-out');
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) {
      return;
    }

    this.dragState.active = true;
    this.dragState.x = pointer.x;
    this.dragState.y = pointer.y;
    document.body.classList.add('is-dragging');
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragState.active) {
      return;
    }

    if (!pointer.isDown) {
      this.handlePointerUp();
      return;
    }

    const deltaX = pointer.x - this.dragState.x;
    const deltaY = pointer.y - this.dragState.y;
    this.dragState.x = pointer.x;
    this.dragState.y = pointer.y;

    this.camera.scrollX -= deltaX / this.camera.zoom;
    this.camera.scrollY -= deltaY / this.camera.zoom;
    this.refreshCameraBounds();
    this.publishPanState('pointer-pan');
  }

  private handlePointerUp(): void {
    const wasActive = this.dragState.active;
    this.dragState.active = false;
    document.body.classList.remove('is-dragging');

    if (wasActive) {
      this.publishState('pointer-pan-end', false);
    }
  }

  private refreshCameraBounds(): void {
    this.camera.preRender();
  }

  private cacheHudElements(): void {
    this.zoomValue = document.querySelector<HTMLElement>('#zoom-value');
    this.zoomStep = document.querySelector<HTMLElement>('#zoom-step');
    this.centerValue = document.querySelector<HTMLElement>('#center-value');
    this.status = document.querySelector<HTMLOutputElement>('#game-status');
  }

  private publishPanState(lastAction: string): void {
    if (this.time.now - this.lastPanStatusAt < PAN_STATUS_INTERVAL_MS) {
      return;
    }

    this.lastPanStatusAt = this.time.now;
    this.publishState(lastAction, false);
  }

  private publishState(lastAction: string, announce = true): void {
    const centerX = this.camera.midPoint.x;
    const centerY = this.camera.midPoint.y;
    const zoom = ZOOM_LEVELS[this.zoomIndex];

    if (this.zoomValue) {
      this.zoomValue.textContent = `${zoom.toFixed(2)}×`;
    }

    if (this.zoomStep) {
      this.zoomStep.textContent = `step ${this.zoomIndex + 1} / ${ZOOM_LEVELS.length}`;
    }

    if (this.centerValue) {
      this.centerValue.textContent = `${Math.round(centerX)}, ${Math.round(centerY)}`;
    }

    if (this.status) {
      if (announce) {
        this.status.textContent = `World map ready. Zoom ${zoom.toFixed(2)}, step ${this.zoomIndex + 1} of ${ZOOM_LEVELS.length}. View center ${Math.round(centerX)}, ${Math.round(centerY)}.`;
      }

      this.status.dataset.zoom = String(zoom);
      this.status.dataset.zoomIndex = String(this.zoomIndex);
      this.status.dataset.centerX = centerX.toFixed(4);
      this.status.dataset.centerY = centerY.toFixed(4);
      this.status.dataset.centerDrift = this.lastCenterDrift.toFixed(6);
      this.status.dataset.wheelEvents = String(this.wheelEvents);
      this.status.dataset.acceptedZoomSteps = String(this.acceptedZoomSteps);
      this.status.dataset.lastWheelDeltaY = String(this.lastWheelDeltaY ?? '');
      this.status.dataset.lastAction = lastAction;
      this.status.dataset.terrainLod = this.terrainLod;
    }

    setWorldGameDebugState({
      ready: true,
      renderer: this.game.renderer.type === WEBGL ? 'webgl' : 'canvas',
      map: {
        seed: this.seed,
        columns: this.terrain.width,
        rows: this.terrain.height,
        tileSize: TERRAIN_TILE_SIZE,
        worldWidth: TERRAIN_WORLD_WIDTH,
        worldHeight: TERRAIN_WORLD_HEIGHT,
        generationMs: Number(this.generationMs.toFixed(2)),
        elevationMin: Number(this.terrain.elevationMin.toFixed(3)),
        elevationMax: Number(this.terrain.elevationMax.toFixed(3)),
        terrainCounts: { ...this.terrain.terrainCounts }
      },
      camera: {
        zoom,
        zoomIndex: this.zoomIndex,
        zoomSteps: [...ZOOM_LEVELS],
        centerX: Number(centerX.toFixed(4)),
        centerY: Number(centerY.toFixed(4)),
        scrollX: Number(this.camera.scrollX.toFixed(4)),
        scrollY: Number(this.camera.scrollY.toFixed(4)),
        anchor: 'viewport-center',
        lastCenterDrift: Number(this.lastCenterDrift.toFixed(6))
      },
      render: {
        lod: this.terrainLod,
        overviewVisible: this.terrainOverview.visible,
        detailVisible: this.terrainDetailLayer.visible
      },
      input: {
        wheelEvents: this.wheelEvents,
        acceptedZoomSteps: this.acceptedZoomSteps,
        lastWheelDeltaY: this.lastWheelDeltaY,
        lastAction
      }
    });
  }

  private readSeed(): number {
    const value = Number.parseInt(new URLSearchParams(window.location.search).get('seed') ?? '0', 10);
    return Number.isFinite(value) ? value : 0;
  }

  private isUpDown(): boolean {
    return Boolean(this.cursors?.up.isDown || this.movementKeys?.up.isDown);
  }

  private isDownDown(): boolean {
    return Boolean(this.cursors?.down.isDown || this.movementKeys?.down.isDown);
  }

  private isLeftDown(): boolean {
    return Boolean(this.cursors?.left.isDown || this.movementKeys?.left.isDown);
  }

  private isRightDown(): boolean {
    return Boolean(this.cursors?.right.isDown || this.movementKeys?.right.isDown);
  }
}
