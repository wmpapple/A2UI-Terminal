import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { startPerformanceMeasurement } from './shared/performance/performanceBudget';
import './styles/globals.css';

startPerformanceMeasurement('homeInteractive');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
