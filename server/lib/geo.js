'use strict';
// Great-circle distance in km.
const rad = x => x * Math.PI / 180;
function distanceKm(aLat, aLng, bLat, bLng) {
  const dLa = rad(bLat - aLat), dLo = rad(bLng - aLng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// Accepts query-string values; returns {lat,lng} only when both are valid coordinates inside a rough Goa+margin box.
function parseLocation(query) {
  const lat = Number(query.get('lat')), lng = Number(query.get('lng'));
  if (query.get('lat') == null || query.get('lng') == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 13 || lat > 17.5 || lng < 72 || lng > 76) return null;   // outside Goa region: ignore rather than route from far away
  return { lat, lng };
}
module.exports = { distanceKm, parseLocation };
