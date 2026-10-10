// Keyboard and touch share one normalized input path. Missing touch keys are false.
export function movementInput(keys, touch = {}) {
  const x =
    Number(!!(keys.has("d") || keys.has("arrowright") || touch.right)) -
    Number(!!(keys.has("a") || keys.has("arrowleft") || touch.left));
  const z =
    Number(!!(keys.has("s") || keys.has("arrowdown") || touch.down)) -
    Number(!!(keys.has("w") || keys.has("arrowup") || touch.up));
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}
