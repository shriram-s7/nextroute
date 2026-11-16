import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { boot } from './ui/store';
import './ui/styles.css';

boot();
createRoot(document.getElementById('root')!).render(<App />);
