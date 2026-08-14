import { boot } from './client/api.js';
import { setupActions } from './client/actions.js';
import { render, startRendering } from './client/render.js';

setupActions();
startRendering();
boot(render);
