/**
 * @file weather-utils.ts
 * @description Open-Meteo API（ジオコーディング付き）を使用して、世界中のあらゆる都市の天気予報を取得するユーティリティ（Remix対応版）
 */

export interface CityInfo {
  nameJP: string;
  lat: number;
  lon: number;
  timezone: string;
}

/**
 * よく使われる主要都市のプリセット
 */
export const CITIES: Record<string, CityInfo> = {
  // オーストラリア
  melbourne: { nameJP: 'メルボルン', lat: -37.8136, lon: 144.9631, timezone: 'Australia/Melbourne' },
  sydney: { nameJP: 'シドニー', lat: -33.8688, lon: 151.2093, timezone: 'Australia/Sydney' },
  cairns: { nameJP: 'ケアンズ', lat: -16.9186, lon: 145.7781, timezone: 'Australia/Brisbane' },
  brisbane: { nameJP: 'ブリスベン', lat: -27.4698, lon: 153.0251, timezone: 'Australia/Brisbane' },
  perth: { nameJP: 'パース', lat: -31.9505, lon: 115.8605, timezone: 'Australia/Perth' },
  adelaide: { nameJP: 'アデレード', lat: -34.9285, lon: 138.6007, timezone: 'Australia/Adelaide' },

  // アジア・日本
  tokyo: { nameJP: '東京', lat: 35.6762, lon: 139.6503, timezone: 'Asia/Tokyo' },
  kyoto: { nameJP: '京都', lat: 35.0116, lon: 135.7681, timezone: 'Asia/Tokyo' },
  osaka: { nameJP: '大阪', lat: 34.6937, lon: 135.5022, timezone: 'Asia/Tokyo' },

  // 北米
  newyork: { nameJP: 'ニューヨーク', lat: 40.7128, lon: -74.0060, timezone: 'America/New_York' },
  losangeles: { nameJP: 'ロサンゼルス', lat: 34.0522, lon: -118.2437, timezone: 'America/Los_Angeles' },

  // ヨーロッパ
  london: { nameJP: 'ロンドン', lat: 51.5074, lon: -0.1278, timezone: 'Europe/London' },
  paris: { nameJP: 'パリ', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' },
  milan: { nameJP: 'ミラン', lat: 45.4642, lon: 9.1900, timezone: 'Europe/Rome' },

  // アフリカ・中東
  cairo: { nameJP: 'カイロ', lat: 30.0444, lon: 31.2357, timezone: 'Africa/Cairo' },
};

/**
 * Open-MeteoのWMO天気コードを日本語のテキストに変換する
 */
function translateWeatherCode(code: number): string {
  if (code === 0) return '晴れ';
  if (code >= 1 && code <= 3) return '曇り';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '雨（にわか雨）';
  if (code >= 85 || code === 86) return '雪';
  if (code >= 95 && code <= 99) return '雷雨';

  return 'お天気';
}

/**
 * 指定された都市名からジオコーディングAPIを使って緯度・経度・タイムゾーンを自動取得する
 */
async function resolveCityInfo(cityNameOrKey: string): Promise<CityInfo> {
  const normalizedKey = cityNameOrKey.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龥]/g, '');
  
  // 1. プリセットに含まれていればそれを優先
  if (CITIES[normalizedKey]) {
    return CITIES[normalizedKey];
  }

  try {
    // 2. プリセットにない場合はOpen-MeteoのジオコーディングAPIで検索
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityNameOrKey)}&count=1&language=ja&format=json`;
    const res = await fetch(geoUrl);
    if (res.ok) {
      const data: any = await res.json();
      if (data.results && data.results.length > 0) {
        const place = data.results[0];
        return {
          nameJP: place.name || cityNameOrKey,
          lat: place.latitude,
          lon: place.longitude,
          timezone: place.timezone || 'UTC',
        };
      }
    }
  } catch (e) {
    // 検索失敗時はフォールバックへ
  }

  // 3. どちらもダメな場合はデフォルトでメルボルンを返す
  return CITIES['melbourne'];
}

/**
 * 指定した都市の現在・昨日・明日・週間予報の気象コンテキストを取得する
 * @param cityKeyOrName 都市名またはキー（例: 'melbourne', '京都' 等）。省略時は 'melbourne'
 */
export async function getCityWeatherContext(cityKeyOrName: string = 'melbourne'): Promise<string> {
  try {
    // 都市名から緯度・経度を解決
    const city = await resolveCityInfo(cityKeyOrName);
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&past_days=1&timezone=${encodeURIComponent(city.timezone)}`;

    const response = await fetch(url);
    if (!response.ok) {
      return '';
    }

    const data: any = await response.json();
    const current = data.current_weather;
    const daily = data.daily;

    if (!current || !daily || !daily.time) {
      return '';
    }

    const currentCondition = translateWeatherCode(current.weathercode);
    const currentTemp = current.temperature;

    const todayStr = new Date().toISOString().split('T')[0];
    let todayIndex = daily.time.findIndex((t: string) => t === todayStr);
    
    if (todayIndex === -1) {
      todayIndex = 1;
    }

    const yesterdayIndex = todayIndex - 1;
    const tomorrowIndex = todayIndex + 1;

    let weatherSummary = `【${city.nameJP}の気象情報】\n`;
    weatherSummary += `- 現在の天気: ${currentCondition}、気温: ${currentTemp}°C\n`;

    if (daily.time[yesterdayIndex]) {
      const yCond = translateWeatherCode(daily.weathercode[yesterdayIndex]);
      const yMax = daily.temperature_2m_max[yesterdayIndex];
      const yMin = daily.temperature_2m_min[yesterdayIndex];
      weatherSummary += `- 昨日(${daily.time[yesterdayIndex]}): ${yCond} (最高 ${yMax}°C / 最低 ${yMin}°C)\n`;
    }

    if (daily.time[todayIndex]) {
      const tMax = daily.temperature_2m_max[todayIndex];
      const tMin = daily.temperature_2m_min[todayIndex];
      weatherSummary += `- 今日(${daily.time[todayIndex]}): 最高 ${tMax}°C / 最低 ${tMin}°C\n`;
    }

    if (daily.time[tomorrowIndex]) {
      const mCond = translateWeatherCode(daily.weathercode[tomorrowIndex]);
      const mMax = daily.temperature_2m_max[tomorrowIndex];
      const mMin = daily.temperature_2m_min[tomorrowIndex];
      weatherSummary += `- 明日(${daily.time[tomorrowIndex]}): ${mCond} (最高 ${mMax}°C / 最低 ${mMin}°C)\n`;
    }

    weatherSummary += `- 週間予報:\n`;
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      const cond = translateWeatherCode(daily.weathercode[i]);
      const max = daily.temperature_2m_max[i];
      const min = daily.temperature_2m_min[i];
      weatherSummary += `  * ${date}: ${cond}, 最高${max}℃/最低${min}℃\n`;
    }

    return weatherSummary;
  } catch (error) {
    return '';
  }
}

/**
 * 互換性のためのラッパー関数（メルボルン専用）
 */
export async function getMelbourneWeatherContext(): Promise<string> {
  return getCityWeatherContext('melbourne');
}

/**
 * chat.tsなどの呼び出し元との互換性のための追加関数
 */
export async function getWeatherInfo(cityKeyOrName: string = 'melbourne'): Promise<string | null> {
  try {
    const city = await resolveCityInfo(cityKeyOrName);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current_weather=true&timezone=${encodeURIComponent(city.timezone)}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data: any = await response.json();
    const current = data.current_weather;
    if (!current) return null;

    const condition = translateWeatherCode(current.weathercode);
    return `${condition}, ${current.temperature}°C (${city.nameJP})`;
  } catch (e) {
    return null;
  }
}