import { allowedWebOrigins, DEFAULT_WEB_ORIGIN } from './web-origin.js';

describe('allowedWebOrigins', () => {
  it('falls back to the Vite dev server when WEB_ORIGIN is not set', () => {
    expect(allowedWebOrigins({})).toEqual([DEFAULT_WEB_ORIGIN]);
    expect(DEFAULT_WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('uses WEB_ORIGIN instead of the default, not in addition to it', () => {
    expect(
      allowedWebOrigins({ WEB_ORIGIN: 'https://console.example' }),
    ).toEqual(['https://console.example']);
  });

  it('accepts several origins separated by commas and trims the spaces', () => {
    expect(
      allowedWebOrigins({
        WEB_ORIGIN: ' http://localhost:5173 , https://console.example ',
      }),
    ).toEqual(['http://localhost:5173', 'https://console.example']);
  });

  it('treats an empty or blank WEB_ORIGIN as not set', () => {
    // An empty list would lock every browser out, which is never what a blank line means.
    expect(allowedWebOrigins({ WEB_ORIGIN: '' })).toEqual([DEFAULT_WEB_ORIGIN]);
    expect(allowedWebOrigins({ WEB_ORIGIN: ' , ' })).toEqual([
      DEFAULT_WEB_ORIGIN,
    ]);
  });
});
