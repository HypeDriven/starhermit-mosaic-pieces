'use strict';

// Mosaic Pieces — bootstrap: capability detection and lifecycle entry point.

import { App } from './app.js';

const app = new App();
window.__mosaic = app; // debug/validation hook

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start());
} else {
  app.start();
}
