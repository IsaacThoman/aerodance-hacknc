import { useEffect, useState } from 'react';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import '@fontsource/comfortaa/400.css';
import '@fontsource/comfortaa/700.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/exo-2/800.css';

const FACES = [
  '400 32px Nunito',
  '700 32px Nunito',
  '800 32px Nunito',
  '900 32px Nunito',
  '400 32px Comfortaa',
  '700 32px Comfortaa',
  '400 32px "Exo 2"',
  '600 32px "Exo 2"',
  '800 32px "Exo 2"',
];

// Canvas text only renders a web font once it has loaded, so the HUD waits for these.
const fontsReady = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => {});

export function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    fontsReady.then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
