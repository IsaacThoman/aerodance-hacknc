// Hype sticker NFTs. The images are the NFTs' art (client/public/stickers), drawn in-engine too.
export const STICKERS = [
  { id: 'bubble', label: 'Bubble Hype' },
  { id: 'koi', label: 'Koi Hype' },
  { id: 'rainbow', label: 'Rainbow Hype' },
];
export const stickerLabel = (id) => STICKERS.find((s) => s.id === id)?.label ?? 'sticker';

const images = {};

// Draws a sticker centred at (cx, cy); calls onLoad once if the image is still loading.
export function drawSticker(g, id, cx, cy, size, onLoad) {
  let img = images[id];
  if (!img) {
    img = new Image();
    img.src = `/stickers/${id}.png`;
    images[id] = img;
  }
  if (!(img.complete && img.naturalWidth)) {
    if (onLoad) img.addEventListener('load', onLoad, { once: true });
    return;
  }
  // The art is a glossy disc on an opaque white square: keep just the disc.
  g.save();
  g.beginPath();
  g.arc(cx, cy, size * 0.452, 0, Math.PI * 2);
  g.clip();
  g.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  g.restore();
}
