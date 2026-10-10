export const COLORS = [
  { name: "Lagoon", value: "#078fff" },
  { name: "Orchid", value: "#b13de9" },
  { name: "Tangerine", value: "#ff9b16" },
  { name: "Apple", value: "#70d930" },
  { name: "Rose", value: "#f45d99" },
  { name: "Pearl", value: "#bdeefa" },
];
export const ACCESSORIES = ["None", "Headphones", "Sprout", "Flower", "Halo"];
export const DEFAULT_CHARACTER = {
  name: "Bloop",
  color: COLORS[1].value,
  accessory: "None",
  gloss: 80,
};
export function sanitizeCharacter(value) {
  return {
    name:
      typeof value?.name === "string"
        ? value.name.slice(0, 20)
        : DEFAULT_CHARACTER.name,
    color: COLORS.some((c) => c.value === value?.color)
      ? value.color
      : DEFAULT_CHARACTER.color,
    accessory: ACCESSORIES.includes(value?.accessory)
      ? value.accessory
      : DEFAULT_CHARACTER.accessory,
    gloss: Number.isFinite(value?.gloss)
      ? Math.min(100, Math.max(0, value.gloss))
      : DEFAULT_CHARACTER.gloss,
  };
}
export function loadCharacter() {
  try {
    return sanitizeCharacter(
      JSON.parse(localStorage.getItem("aerodance.character")),
    );
  } catch {
    return { ...DEFAULT_CHARACTER };
  }
}
