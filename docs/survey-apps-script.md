# Pre-Talk Survey → Google Sheet setup

The `/survey` page posts responses to a Google Apps Script Web App, which
appends each response as a row in a Google Sheet. No backend to host.

## 1. Create the Sheet

1. Create a new Google Sheet, e.g. **"PharmaSync AMS Pre-Talk Survey"**.
2. Rename the first tab to `Responses`.
3. Add a header row:

   ```
   timestamp | name | email | role | a1 | a2 | a3 | a4 | a5 | a6 | b1 | b2 | b3 | b4 | c1 | c2 | c3 | o1 | o2 | o3 | o4
   ```

   `a1`–`a6` = Section A (Application and Approval Process), `b1`–`b4` =
   Section B (Tracking), `c1`–`c3` = Section C (Overall User Experience),
   `o1`–`o4` = the four open-ended questions. Question wording lives in
   `src/pages/Survey.tsx`.

## 2. Add the Apps Script

1. In the Sheet: **Extensions → Apps Script**.
2. Replace the default `Code.gs` contents with:

   ```js
   function doPost(e) {
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responses');
     const d = JSON.parse(e.postData.contents);
     sheet.appendRow([
       new Date(),
       d.name,
       d.email,
       d.role,
       d.a1, d.a2, d.a3, d.a4, d.a5, d.a6,
       d.b1, d.b2, d.b3, d.b4,
       d.c1, d.c2, d.c3,
       d.o1 || '', d.o2 || '', d.o3 || '', d.o4 || '',
     ]);
     return ContentService.createTextOutput(JSON.stringify({ ok: true }))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

3. Save the project (any name, e.g. "survey-intake").

## 3. Deploy as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy, and copy the generated URL — it ends in `/exec`.

## 4. Wire it into the app

Set the copied URL as `VITE_SHEETS_ENDPOINT`:

- Locally: add to `.env` (see `.env.example`).
- On Netlify: **Site configuration → Environment variables** → add
  `VITE_SHEETS_ENDPOINT` with the same value, then trigger a redeploy.

## Notes

- The frontend submits with `mode: "no-cors"` and `Content-Type:
  text/plain;charset=utf-8` — Apps Script Web Apps don't return CORS headers,
  and `text/plain` keeps the request a CORS "simple request" so the browser
  skips a preflight `OPTIONS` call the Web App can't answer. The response is
  opaque either way; the app treats "fetch didn't throw" as success.
- Redeploying the Apps Script after edits requires **Deploy → Manage
  deployments → Edit → New version**, or the `/exec` URL keeps serving the
  old code.
