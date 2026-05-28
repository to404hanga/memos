import React from 'react';
import { createRoot } from 'react-dom/client';
import { PetRenderer } from './PetRenderer';
import './styles.css';

const container = document.getElementById('pet-root');
if (container) {
  const root = createRoot(container);
  root.render(<PetRenderer />);
}
