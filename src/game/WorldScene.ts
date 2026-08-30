import { Input, Math as PhaserMath, Scene, Scenes, WEBGL } from 'phaser';
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
const PAN_SPEED = 540;
const WHEEL_STEP_COOLDOWN_MS = 110;
const PAN_STATUS_INTERVAL_MS = 50;

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
    const atlasKey = 'world-terrain-tiles';
    const texture = this.textures.createCanvas(
      atlasKey,
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
      atlasKey,
      TERRAIN_TILE_SIZE,
      TERRAIN_TILE_SIZE,
      0,
      0,
      0
    );

    if (!tileset) {
      throw new Error('Unable to create the WorldGame Phaser tileset.');
    }

    tilemap.createLayer(0, tileset, 0, 0);
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
    this.camera.setZoom(ZOOM_LEVELS[this.zoomIndex]);
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
