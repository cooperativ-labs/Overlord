export function parseNewVersion(version) {
  if (typeof version !== 'string') return null;

  const parts = version.split('.');
  if (parts.length !== 3) return null;

  const [majorStr, datetimeStr, xStr] = parts;
  const major = Number.parseInt(majorStr, 10);
  const x = Number.parseInt(xStr, 10);

  if (Number.isNaN(major) || Number.isNaN(x)) return null;
  if (!/^\d{10}$/.test(datetimeStr)) return null;

  return { major, datetime: datetimeStr, x };
}

// UTC yymmddhhmm
export function generateDatetimeComponent(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}${hh}${min}`;
}

export function deriveCliVersion(appVersion) {
  return appVersion;
}
