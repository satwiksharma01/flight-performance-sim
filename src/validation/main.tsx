import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ValidationPage } from './ValidationPage.js';
import '../app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ValidationPage />
  </StrictMode>,
);
