import './styles.css';
import { startWorldGame } from './game/main';

let game: Phaser.Game | undefined;

const boot = () => {
  game?.destroy(true);
  game = startWorldGame('game-container');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.destroy(true);
    game = undefined;
  });
}
