import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerServiceWorker } from './pwa/register';
import './app/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Nedostaje #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registerServiceWorker();
