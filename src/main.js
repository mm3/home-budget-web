/** Entry point: starts the app and exposes it for debugging. */

import { startApp } from './ui/app.js';

const root = document.getElementById('app');
window.homeBudget = startApp(root);
