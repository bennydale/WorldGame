export interface WorldGameDebugState {
  ready: true;
  renderer: string;
  map: {
    seed: number;
    columns: number;
    rows: number;
    tileSize: number;
    worldWidth: number;
    worldHeight: number;
    generationMs: number;
    elevationMin: number;
    elevationMax: number;
    terrainCounts: Record<string, number>;
  };
  camera: {
    zoom: number;
    zoomIndex: number;
    zoomSteps: number[];
    centerX: number;
    centerY: number;
    scrollX: number;
    scrollY: number;
    anchor: 'viewport-center';
    lastCenterDrift: number;
  };
  render: {
    lod: 'detail' | 'overview';
    overviewVisible: boolean;
    detailVisible: boolean;
  };
  input: {
    wheelEvents: number;
    acceptedZoomSteps: number;
    lastWheelDeltaY: number | null;
    lastAction: string;
  };
}

declare global {
  interface Window {
    __WORLDGAME_DEBUG__?: WorldGameDebugState;
  }
}

export const setWorldGameDebugState = (state: WorldGameDebugState): void => {
  window.__WORLDGAME_DEBUG__ = state;
};
