/**
 * Distances. The world is measured in real distances, never in tiles: everything is stored in
 * kilometres and shown in miles (with kilometres alongside).
 */

export const KM_PER_MILE = 1.609344;

/** Kilometres per degree of latitude (and of longitude at the equator). */
export const KM_PER_DEGREE = 111.32;

/** Earth's radius, the default size of a globe world. */
export const EARTH_RADIUS_KM = 6371;

export const milesToKm = (mi: number): number => mi * KM_PER_MILE;
export const kmToMiles = (km: number): number => km / KM_PER_MILE;

/** A distance for people to read: "1,240 mi (1,996 km)". */
export function formatDistance(km: number): string {
  const mi = kmToMiles(km);
  const round = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en-US');
  return `${round(mi)} mi (${round(km)} km)`;
}

/** A latitude for people to read: "23.4°N", "0°", "12°S". */
export function formatLatitude(lat: number): string {
  const v = Math.round(Math.abs(lat) * 10) / 10;
  if (v === 0) return '0°';
  return `${v}°${lat > 0 ? 'N' : 'S'}`;
}
