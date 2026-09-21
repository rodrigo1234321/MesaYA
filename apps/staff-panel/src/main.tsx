import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallbackTitle="Error en Panel de Personal"
      fallbackMessage="El panel de mozo/personal encontró un problema al inicializar. Puedes recargar para restaurar la sesión."
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
