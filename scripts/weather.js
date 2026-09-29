// Weatherman Trusty: the forecast for wherever the viewer is, in Trusty's words. Used by the home page
// card and pages/weather.html.
//
// The browser only asks for the location after a tap. Once the viewer says yes, their rough spot
// (rounded to about 1 km) is kept on their device so the site never has to ask again, and it's
// re-detected whenever the browser already allows it, so it follows them when they travel. Nothing goes
// to our server: the page asks Open-Meteo for the weather and BigDataCloud for the town's name.

const SPOT_KEY = 'trusty:weather:spot';
// Countries that use Fahrenheit (and mph).
const FAHRENHEIT = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH']);

const round = (n) => Math.round(n * 100) / 100;

function readSpot() {
  try {
    const spot = JSON.parse(localStorage.getItem(SPOT_KEY));
    return spot && Number.isFinite(spot.lat) && Number.isFinite(spot.lon) ? spot : null;
  } catch { return null; }
}
function saveSpot(spot) { try { localStorage.setItem(SPOT_KEY, JSON.stringify(spot)); } catch { /* storage blocked */ } }
function forgetSpot() { try { localStorage.removeItem(SPOT_KEY); } catch { /* storage blocked */ } }

/* ---------- Where the viewer is ---------- */

async function permissionState() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { return 'unknown'; }
}

function locate() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) }),
      reject,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 30 * 60 * 1000 });
  });
}

// Never throws: without a name, the forecast still works.
async function placeName(lat, lon) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (!res.ok) throw new Error(`BigDataCloud ${res.status}`);
    const data = await res.json();
    const town = data.city || data.locality || '';
    const region = data.principalSubdivision || data.countryName || '';
    return {
      place: town && region && town !== region ? `${town}, ${region}` : town || region,
      country: data.countryCode || '',
    };
  } catch { return { place: '', country: '' }; }
}

async function findSpot(previous) {
  const { lat, lon } = await locate();
  // Only look the name up again if they've moved.
  const near = previous && Math.abs(previous.lat - lat) < 0.05 && Math.abs(previous.lon - lon) < 0.05;
  const spot = { lat, lon, place: near ? previous.place : '', country: near ? previous.country : '' };
  if (!spot.place) Object.assign(spot, await placeName(lat, lon));
  saveSpot(spot);
  return spot;
}

// Resolves to { status: 'ready', report } or { status: 'ask' | 'denied' | 'unsupported' | 'error' }.
// Pass ask: true only from a tap, since that may pop up the browser's location prompt.
export async function loadWeather({ ask = false } = {}) {
  if (!('geolocation' in navigator)) return { status: 'unsupported' };
  const state = await permissionState();
  if (state === 'denied') {
    forgetSpot();
    return { status: 'denied' };
  }
  let spot = readSpot();
  if (ask || state === 'granted') {
    try {
      spot = await findSpot(spot);
    } catch (err) {
      if (err && err.code === 1) { // PERMISSION_DENIED
        forgetSpot();
        return { status: 'denied' };
      }
      if (!spot) return { status: 'error' };
    }
  }
  // Some browsers (iOS Safari) forget the permission after a while; use the saved spot rather than ask again.
  if (!spot) return { status: 'ask' };
  try {
    return { status: 'ready', report: await forecast(spot) };
  } catch {
    return { status: 'error' };
  }
}

/* ---------- The forecast ---------- */

// WMO weather codes, as Open-Meteo reports them.
function kindOf(code) {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const LABELS = {
  partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', drizzle: 'Drizzle',
  rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms',
};
export function labelOf(kind, night = false) {
  if (kind === 'clear') return night ? 'Clear' : 'Sunny';
  return LABELS[kind] || 'Cloudy';
}

// For "It's 72° and ___": "raining", not "rain".
const NOW_WORDS = { drizzle: 'drizzling', rain: 'raining', snow: 'snowing', storm: 'stormy' };
export function nowPhrase(kind, night = false) {
  return NOW_WORDS[kind] || labelOf(kind, night).toLowerCase();
}

// Open-Meteo gives local times without a zone ("2026-09-28T14:00"); reading them as UTC keeps them as-is.
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const hourLabel = (t) => hourFormat.format(new Date(`${t}Z`));
const clockLabel = (t) => clockFormat.format(new Date(`${t}Z`));

async function forecast(spot) {
  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: 2,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return buildReport(await res.json(), spot);
}

function buildReport({ current: now, hourly, daily }, spot) {
  const f = spot.country ? FAHRENHEIT.has(spot.country) : /-US$/i.test(navigator.language || '');
  const temp = (c) => `${Math.round(f ? c * 9 / 5 + 32 : c)}°`;
  const speed = (kmh) => (f ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`);
  const rainAt = (i) => hourly.precipitation_probability[i] ?? 0;

  const day = (d) => ({
    date: daily.time[d],
    kind: kindOf(daily.weather_code[d]),
    highC: daily.temperature_2m_max[d],
    high: temp(daily.temperature_2m_max[d]),
    low: temp(daily.temperature_2m_min[d]),
    rain: daily.precipitation_probability_max[d] ?? 0,
    uv: Math.round(daily.uv_index_max[d] ?? 0),
    windKmh: daily.wind_speed_10m_max[d] ?? 0,
    wind: speed(daily.wind_speed_10m_max[d] ?? 0),
    sunrise: clockLabel(daily.sunrise[d]),
    sunset: clockLabel(daily.sunset[d]),
  });
  const today = day(0);
  const tomorrow = day(1);
  // After sunset, Trusty talks about tomorrow, like a real evening forecast.
  const evening = now.time >= daily.sunset[0];
  const focus = evening ? tomorrow : today;

  const nowHour = now.time.slice(0, 13);
  const start = Math.max(0, hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const hours = [];
  for (let i = start; i < Math.min(start + 12, hourly.time.length); i++) {
    // "Now" shows the current conditions, so it matches the big reading.
    const first = i === start;
    hours.push({
      label: first ? 'Now' : hourLabel(hourly.time[i]),
      temp: temp(first ? now.temperature_2m : hourly.temperature_2m[i]),
      rain: rainAt(i),
      kind: kindOf(first ? now.weather_code : hourly.weather_code[i]),
      night: !(first ? now.is_day : hourly.is_day[i]),
    });
  }

  const wet = hourly.time.findIndex((t, i) => i >= start && t.startsWith(focus.date) && rainAt(i) >= 50);

  return {
    place: spot.place,
    evening,
    today,
    tomorrow,
    hours,
    now: {
      temp: temp(now.temperature_2m),
      feels: temp(now.apparent_temperature),
      kind: kindOf(now.weather_code),
      night: !now.is_day,
      wind: speed(now.wind_speed_10m),
    },
    sun: evening ? { label: 'Sunrise', time: tomorrow.sunrise }
      : now.time < daily.sunrise[0] ? { label: 'Sunrise', time: today.sunrise }
        : { label: 'Sunset', time: today.sunset },
    wet: wet < 0 ? null : {
      at: hourLabel(hourly.time[wet]),
      soon: wet === start,
      snow: kindOf(hourly.weather_code[wet]) === 'snow',
    },
  };
}

/* ---------- What Trusty says ---------- */

const OPENERS = {
  clear: [
    'Not a cloud in the sky. Even I look good in this light.',
    'Sunshine, baby. Go outside before I drag you out there.',
    'Clear skies. Perfect weather for galloping.',
  ],
  partly: [
    "Some sun, some clouds. The sky can't make up its mind.",
    "A few clouds rolling through. Nothing I can't handle.",
    "Partly cloudy, which means partly sunny. You're welcome.",
  ],
  cloudy: [
    'Gray skies. Not great, not terrible.',
    'Cloudy all around. The sun called in sick.',
    'Overcast. Looks like pencil shading up there.',
  ],
  fog: [
    "Foggy out there. I can't even see my own tail.",
    "Fog's rolling in. Drive slow or answer to me.",
  ],
  drizzle: [
    'Light drizzle. Annoying, like a fly on my back.',
    'Just a little drizzle. Hood up, champ.',
  ],
  rain: [
    "Rain's coming down. I'm staying in the barn.",
    "It's a wet one. Don't say I didn't warn you.",
    'Rain, rain, and more rain. Great day to read some comics.',
  ],
  snow: [
    'Snow! Build a snow horse. It better look like me.',
    "Snow's falling. Bundle up, I'm not your mom.",
  ],
  storm: [
    'Thunderstorms. Stay inside unless you want to get zapped.',
    "Storms rolling in. Lightning's loud, but I'm louder.",
  ],
};

const SIGNOFFS = [
  'Back to you.',
  "That's the forecast. Now get outta here.",
  'This has been Trusty, your weather horse.',
  'Trust the horse.',
];

function tempLine({ highC, high }) {
  if (highC >= 35) return `A high of ${high}. That's dangerously hot. Drink water or I'll kick you.`;
  if (highC >= 29) return `Heating up to ${high}. Stay in the shade.`;
  if (highC >= 22) return `Getting up to ${high}, which is basically perfect.`;
  if (highC >= 15) return `Topping out around ${high}, so maybe bring a light jacket.`;
  if (highC >= 7) return `Only ${high} for a high. Jacket weather.`;
  if (highC >= 0) return `A high of just ${high}. Wear a real coat.`;
  return `It won't even get above ${high}. My hooves are freezing just thinking about it.`;
}

// Same line all day for everyone in the same weather, so the home card and the page agree.
function pick(list, key) {
  let hash = 5381;
  for (const ch of key) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

// { short } is one line for the home card; { long } is the full forecast.
export function trustySays(r) {
  const day = r.evening ? r.tomorrow : r.today;
  const opener = pick(OPENERS[day.kind], day.date + day.kind);
  const lines = [];
  if (r.evening) lines.push(`It's ${r.now.temp} and ${nowPhrase(r.now.kind, r.now.night)} right now. As for tomorrow:`);
  lines.push(opener, tempLine(day));
  if (r.wet) {
    const { at, soon, snow } = r.wet;
    if (soon) lines.push(snow ? 'Snow any minute now, so bundle up.' : "Rain's likely any minute now, so grab an umbrella.");
    else lines.push(`${snow ? 'Snow' : 'Rain'} likely around ${at}${r.evening ? ' tomorrow' : ''}, so ${snow ? 'bundle up' : 'bring an umbrella'}.`);
  }
  if (day.windKmh >= 40) lines.push(`Hold onto your hat, winds up to ${day.wind}.`);
  if (day.uv >= 8 && (day.kind === 'clear' || day.kind === 'partly')) lines.push("UV's way up there, so wear sunscreen.");
  lines.push(pick(SIGNOFFS, day.date));
  return {
    short: r.evening ? `Tomorrow: ${opener}` : opener,
    long: lines.join(' '),
  };
}

/* ---------- Doodles ---------- */

const SUN = '<circle class="sun" cx="32" cy="32" r="11"/><path d="M32 9v7M32 48v7M9 32h7M48 32h7M15.5 15.5l5 5M43.5 43.5l5 5M15.5 48.5l5-5M43.5 20.5l5-5"/>';
const MOON = '<path class="moon" d="M40 16.7A20 20 0 1 0 48.8 40.8 16 16 0 0 1 40 16.7z"/>';
const CLOUD = (cls = 'cloud') => `<path class="${cls}" d="M16 46c-8 0-9-11-1-13-1-9 10-13 15-7 3-9 17-8 17 2 9 0 10 14 2 18z"/>`;
const HIGH_CLOUD = (cls) => `<g transform="translate(0 -7)">${CLOUD(cls)}</g>`;

const ART = {
  clear: (night) => (night ? MOON : SUN),
  partly: (night) => `<g transform="translate(-6 -8) scale(.8)">${night ? MOON : SUN}</g><g transform="translate(5 5)">${CLOUD()}</g>`,
  cloudy: () => CLOUD(),
  fog: () => '<path d="M12 24c8-3 14 3 20 0s12-3 20 0M10 34c8-3 14 3 22 0s12-3 22 0M14 44c8-3 14 3 20 0s12-3 18 0"/>',
  drizzle: () => `${HIGH_CLOUD()}<path class="drop" d="M25 46l-2 4M37 46l-2 4"/>`,
  rain: () => `${HIGH_CLOUD()}<path class="drop" d="M22 45l-3 9M32 45l-3 9M42 45l-3 9"/>`,
  snow: () => `${HIGH_CLOUD()}<path class="flake" d="M24 45v10M19.7 47.5l8.6 5M19.7 52.5l8.6-5M40 45v10M35.7 47.5l8.6 5M35.7 52.5l8.6-5"/>`,
  storm: () => `${HIGH_CLOUD('cloud cloud-dark')}<path class="bolt" d="M34 37l-8 12h7l-4 10 12-15h-7l4-7z"/>`,
};

// A hand-drawn weather icon (static markup, never user data). Pass a label to make it readable by screen readers.
export function doodle(kind, night = false, label = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="doodle" viewBox="0 0 64 64">${(ART[kind] || ART.cloudy)(night)}</svg>`;
  const svg = t.content.firstElementChild;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}
