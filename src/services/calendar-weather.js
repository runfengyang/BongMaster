const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const CACHE_TTL = 30 * 60 * 1000
const cache = new Map()
const wttrCache = new Map()
let openMeteoBlockedUntil = 0

const getCached = (map, key) => {
  const entry = map.get(key)
  if (!entry) return null
  if (entry.expires < Date.now()) {
    map.delete(key)
    return null
  }
  return entry.value
}
const setCached = (map, key, value, ttl = CACHE_TTL) => {
  map.set(key, { value, expires: Date.now() + ttl })
  return value
}
const fetchJson = async (url, timeout = 12000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`天气服务返回 ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
const WTTR_CODES = {
  113: 0, 116: 2, 119: 3, 122: 3, 143: 45, 149: 45, 248: 45, 260: 45,
  176: 61, 263: 61, 266: 61, 293: 61, 296: 61, 353: 61,
  299: 63, 302: 63, 356: 63, 305: 65, 308: 65, 359: 65,
  179: 71, 323: 71, 326: 71, 368: 71, 329: 73, 332: 73, 371: 73,
  335: 75, 338: 75, 227: 75, 230: 75,
  200: 95, 386: 95, 389: 95, 392: 95, 395: 95,
  281: 66, 284: 66, 311: 66, 314: 66, 317: 66, 320: 66, 362: 66, 365: 66,
  350: 77, 374: 77, 377: 77
}
const wttrCode = code => WTTR_CODES[Number(code)] ?? 3

export async function searchWeatherCities(query) {
  const text = String(query || '').trim()
  if (!text) return []
  const url = new URL(GEOCODING_URL)
  url.searchParams.set('name', text)
  url.searchParams.set('count', '8')
  url.searchParams.set('language', 'zh')
  url.searchParams.set('format', 'json')
  const data = await fetchJson(url)
  return (data.results || []).map(item => ({
    id: item.id,
    name: item.name,
    admin1: item.admin1 || '',
    country: item.country || '',
    latitude: item.latitude,
    longitude: item.longitude,
    displayName: [item.name, item.admin1, item.country].filter(Boolean).join('，')
  }))
}

async function wttrWeatherFor(location, dateKey) {
  const wttr = await fetchWttr(location)
  const day = wttr.days.find(item => item.date === dateKey)
  return day
    ? {
        locationName: location.name,
        date: dateKey,
        isCurrent: false,
        temperature: day.high,
        low: day.low,
        apparent: null,
        humidity: null,
        precipitationProbability: day.precipitationProbability,
        description: day.description,
        icon: day.icon,
        weatherCode: day.weatherCode
      }
    : {
        locationName: location.name,
        date: wttr.current.date || dateKey,
        isCurrent: true,
        temperature: wttr.current.temperature,
        low: null,
        apparent: wttr.current.apparent,
        humidity: wttr.current.humidity,
        precipitationProbability: null,
        description: wttr.current.description,
        icon: wttr.current.icon,
        weatherCode: wttr.current.weatherCode
      }
}

async function wttrForecast(location) {
  const wttr = await fetchWttr(location)
  return {
    current: {
      temperature: wttr.current.temperature,
      apparent: wttr.current.apparent,
      humidity: wttr.current.humidity,
      windSpeed: wttr.current.windSpeed,
      description: wttr.current.description,
      icon: wttr.current.icon
    },
    days: wttr.days
  }
}

export async function fetchWeather(location, dateKey) {
  const cacheKey = `${location.latitude},${location.longitude},${dateKey}`
  const cached = getCached(cache, cacheKey)
  if (cached) return cached
  if (Date.now() < openMeteoBlockedUntil) return setCached(cache, cacheKey, await wttrWeatherFor(location, dateKey))
  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', location.latitude)
  url.searchParams.set('longitude', location.longitude)
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '16')
  try {
    const data = await fetchJson(url)
    const dailyIndex = (data.daily?.time || []).indexOf(dateKey)
    const current = data.current || {}
    const result = dailyIndex >= 0
      ? {
          locationName: location.name,
          date: dateKey,
          isCurrent: false,
          temperature: Math.round(data.daily.temperature_2m_max[dailyIndex]),
          low: Math.round(data.daily.temperature_2m_min[dailyIndex]),
          apparent: null,
          humidity: null,
          precipitationProbability: data.daily.precipitation_probability_max?.[dailyIndex] ?? null,
          description: weatherDescription(data.daily.weather_code[dailyIndex]),
          icon: weatherIcon(data.daily.weather_code[dailyIndex], true),
          weatherCode: data.daily.weather_code[dailyIndex]
        }
      : {
          locationName: location.name,
          date: data.current?.time?.slice(0, 10) || dateKey,
          isCurrent: true,
          temperature: Math.round(current.temperature_2m),
          low: null,
          apparent: Math.round(current.apparent_temperature),
          humidity: current.relative_humidity_2m,
          precipitationProbability: null,
          description: weatherDescription(current.weather_code),
          icon: weatherIcon(current.weather_code, current.is_day !== 0),
          weatherCode: current.weather_code
        }
    return setCached(cache, cacheKey, result)
  } catch (error) {
    if (String(error.message || '').includes('429')) openMeteoBlockedUntil = Date.now() + 10 * 60 * 1000
    return setCached(cache, cacheKey, await wttrWeatherFor(location, dateKey))
  }
}

async function fetchWttr(location) {
  const cacheKey = `${location.latitude},${location.longitude}`
  const cached = getCached(wttrCache, cacheKey)
  if (cached) return cached
  const url = `https://wttr.in/${encodeURIComponent(`${location.latitude},${location.longitude}`)}?format=j1&lang=zh`
  const data = await fetchJson(url, 15000)
  const currentRaw = data.current_condition?.[0] || {}
  const days = (data.weather || []).map(day => {
    const hourly = day.hourly?.find(item => item.time === '1200') || day.hourly?.[4] || {}
    const code = wttrCode(hourly.weatherCode || currentRaw.weatherCode)
    return {
      date: day.date,
      high: Math.round(Number(day.maxtempC)),
      low: Math.round(Number(day.mintempC)),
      precipitationProbability: Number(hourly.chanceofrain ?? 0),
      description: weatherDescription(code),
      icon: weatherIcon(code, true),
      weatherCode: code
    }
  })
  const currentCode = wttrCode(currentRaw.weatherCode)
  const current = {
    date: days[0]?.date || '',
    temperature: Math.round(Number(currentRaw.temp_C)),
    apparent: Math.round(Number(currentRaw.FeelsLikeC)),
    humidity: Number(currentRaw.humidity),
    windSpeed: Number(currentRaw.windspeedKmph),
    description: weatherDescription(currentCode),
    icon: weatherIcon(currentCode, true),
    weatherCode: currentCode
  }
  return setCached(wttrCache, cacheKey, { current, days })
}

export async function fetchWeatherForecast(location) {
  if (Date.now() < openMeteoBlockedUntil) return wttrForecast(location)
  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', location.latitude)
  url.searchParams.set('longitude', location.longitude)
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '7')
  try {
    const data = await fetchJson(url)
    return {
      current: {
        temperature: Math.round(data.current?.temperature_2m),
        apparent: Math.round(data.current?.apparent_temperature),
        humidity: data.current?.relative_humidity_2m,
        windSpeed: data.current?.wind_speed_10m,
        description: weatherDescription(data.current?.weather_code),
        icon: weatherIcon(data.current?.weather_code, data.current?.is_day !== 0)
      },
      days: (data.daily?.time || []).map((date, index) => ({
        date,
        high: Math.round(data.daily.temperature_2m_max[index]),
        low: Math.round(data.daily.temperature_2m_min[index]),
        precipitationProbability: data.daily.precipitation_probability_max?.[index] ?? null,
        description: weatherDescription(data.daily.weather_code[index]),
        icon: weatherIcon(data.daily.weather_code[index], true)
      }))
    }
  } catch (error) {
    if (String(error.message || '').includes('429')) openMeteoBlockedUntil = Date.now() + 10 * 60 * 1000
    return wttrForecast(location)
  }
}

export function weatherDescription(code) {
  const descriptions = {
    0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '强阵雪',
    95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹'
  }
  return descriptions[code] || '天气未知'
}

export function weatherIcon(code, daytime = true) {
  if (code === 0) return daytime ? 'fas fa-sun' : 'fas fa-moon'
  if ([1, 2].includes(code)) return daytime ? 'fas fa-cloud-sun' : 'fas fa-cloud-moon'
  if (code === 3) return 'fas fa-cloud'
  if ([45, 48].includes(code)) return 'fas fa-smog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'fas fa-cloud-rain'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'fas fa-cloud-showers-heavy'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'fas fa-snowflake'
  if ([95, 96, 99].includes(code)) return 'fas fa-cloud-bolt'
  return 'fas fa-cloud'
}
