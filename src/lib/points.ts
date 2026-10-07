/** Formatting for the site's story-point style estimate field (e.g. "Estimate Working Hour"). */

/** "h" when the field is measured in hours (its name says so), otherwise "pts". */
export const pointsUnit = (fieldName?: string | null) => (fieldName && /hour/i.test(fieldName) ? 'h' : 'pts');

export function formatPoints(value: number | null | undefined, fieldName?: string | null): string {
  if (value === null || value === undefined) return '—';
  const n = Math.round(value * 100) / 100;
  const unit = pointsUnit(fieldName);
  return unit === 'h' ? `${n}h` : `${n} pts`;
}
