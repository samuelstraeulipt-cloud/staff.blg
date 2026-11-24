/* =========================================================================
   BLG TeamHub — HTTP functions
   GET https://www.blgsports.ch/_functions/teamhubCal/<token>.ics
   A person's own TeamHub calendar, for Apple / Google / Outlook to subscribe
   to. Everything is decided in calendarFeed (teamhub.web.js); this file only
   turns the answer into an HTTP response. An unknown token gets an empty
   calendar, never an error page, so a stopped subscription empties out.
   ========================================================================= */
import { ok } from 'wix-http-functions';
import { calendarFeed } from 'backend/teamhub.web.js';

const EMPTY = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//BLG Sports//TeamHub//EN\r\n' +
  'X-WR-CALNAME:BLG TeamHub\r\nEND:VCALENDAR\r\n';

export async function get_teamhubCal(request) {
  const seg = String(((request && request.path) || [])[0] || '');
  const token = seg.replace(/\.ics$/i, '');
  let body;
  try { body = await calendarFeed(token); }
  catch (e) { console.error('teamhubCal:', e && e.message); body = EMPTY; }
  return ok({
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="blg-teamhub.ics"',
      'Cache-Control': 'no-cache, no-store, max-age=0'
    },
    body
  });
}
