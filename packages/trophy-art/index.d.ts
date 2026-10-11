export type TrophySpec = {
  id: string;
  created_at: Date | string;
  score: number | null;
  pops: number | null;
  sync: number | null;
  flair: number | null;
};
export const MAX_PNG_BYTES: number;
export function validateTrophyPng(png: Buffer): Buffer;
export function ensureTrophyArt(
  db: { query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }> },
  render: (battle: TrophySpec) => Promise<Buffer>,
  battleId: string,
): Promise<boolean>;
