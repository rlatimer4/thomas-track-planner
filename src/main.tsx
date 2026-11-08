import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { StoreProvider } from './ui/store';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
