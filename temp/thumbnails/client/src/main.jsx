import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// No StrictMode: its double-mounted effects would make the frame-stepped capture less predictable.
createRoot(document.getElementById('root')).render(<App />);
