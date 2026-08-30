import { AUTO, Game, Scale } from 'phaser';
import { WorldScene } from './WorldScene';

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 720;

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#07131a',
  parent: 'game-container',
  scene: [WorldScene],
  render: {
    antialias: false,
    pixelArt: true,
    roundPixels: true
  },
  input: {
    mouse: {
      preventDefaultWheel: true
}
  },
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  }
};

export const startWorldGame = (parent: string): Phaser.Game => {
  return new Game({ ...config, parent });
};
