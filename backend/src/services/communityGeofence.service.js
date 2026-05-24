'use strict';

const db = require('../models');

const R_KM = 6371;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c * 1000;
}

function parseKeywords(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 60 * 1000;

async function loadActiveAreas() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_MS) return _cache;
  const Area = db.CommunityServiceArea;
  const Community = db.Community;
  if (!Area) {
    _cache = [];
    _cacheAt = now;
    return _cache;
  }
  const rows = await Area.findAll({
    where: { status: 'active' },
    order: [['community_id', 'ASC'], ['id', 'ASC']]
  });
  const commMap = {};
  if (Community) {
    const comms = await Community.findAll({
      where: { status: 'active' },
      attributes: ['id', 'name']
    });
    comms.forEach((c) => {
      commMap[c.id] = c.name;
    });
  }
  _cache = rows.map((r) => ({
    community_id: Number(r.community_id),
    community_name: commMap[r.community_id] || '',
    center_name: r.center_name,
    center_lat: Number(r.center_lat),
    center_lng: Number(r.center_lng),
    radius_meters: Number(r.radius_meters) || 300,
    keywords: parseKeywords(r.keywords)
  }));
  _cacheAt = now;
  return _cache;
}

function resolveByTextFromAreas(text, areas) {
  if (!text || !areas.length) return null;
  const t = String(text);
  let best = null;
  for (const area of areas) {
    const keys = [area.center_name, area.community_name, ...(area.keywords || [])].filter(Boolean);
    for (const k of keys) {
      if (k && t.indexOf(k) >= 0) {
        if (!best || k.length > best.keyword.length) {
          best = { community_id: area.community_id, keyword: k, area };
        }
      }
    }
  }
  return best ? best.community_id : null;
}

function resolveByLatLngFromAreas(lat, lng, areas) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || !areas.length) return null;
  let hit = null;
  let minDist = Infinity;
  for (const area of areas) {
    const dist = haversineMeters(la, ln, area.center_lat, area.center_lng);
    if (dist <= area.radius_meters && dist < minDist) {
      minDist = dist;
      hit = {
        community_id: area.community_id,
        distance_m: Math.round(dist),
        center_name: area.center_name
      };
    }
  }
  return hit;
}

async function resolveCommunityFromInput(input) {
  const areas = await loadActiveAreas();
  const lat = input && input.latitude != null ? input.latitude : input && input.lat;
  const lng = input && input.longitude != null ? input.longitude : input && input.lng;
  const geoHit = resolveByLatLngFromAreas(lat, lng, areas);
  if (geoHit) {
    return { community_id: geoHit.community_id, match_type: 'geofence', ...geoHit };
  }
  const text = [input && input.name, input && input.address, input && input.label]
    .filter((s) => s != null && s !== '')
    .join(' ');
  const textId = resolveByTextFromAreas(text, areas);
  if (textId != null) {
    return { community_id: textId, match_type: 'keyword' };
  }
  return null;
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  haversineMeters,
  loadActiveAreas,
  resolveByTextFromAreas,
  resolveByLatLngFromAreas,
  resolveCommunityFromInput,
  invalidateCache
};
