import { requirePasscode } from "./_lib/auth.js";
import { listMonth, guessBank, serviceAccountEmail, DriveNotConfigured } from "./_lib/gdrive.js";

/*
 * GET /api/drive?month=YYYY-MM
 * -> { ok, month, folderFound, months, files: [{ id, name, size, modifiedTime, bank }] }
 *
 * Lists the statements Siddharth dropped into Drive for that month so the
 * import screen can pull them in without downloading and re-uploading.
 */
export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }
  const month = String((req.query && req.query.month) || "");
  if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ ok: false, error: "month must be YYYY-MM" }); return; }
  try {
    const { folder, files, months } = await listMonth(month);
    res.status(200).json({
      ok: true,
      month,
      folderFound: !!folder,
      months,
      // An unshared folder looks empty rather than failing, so say what to check.
      ...(!months.length ? { hint: `No month folders visible. Share the Drive folder "Statements" with ${serviceAccountEmail()} as Viewer.` } : {}),
      files: files.map((f) => ({
        id: f.id, name: f.name, size: Number(f.size) || null, modifiedTime: f.modifiedTime, bank: guessBank(f.name),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    if (e instanceof DriveNotConfigured) {
      res.status(200).json({ ok: false, notConfigured: true, error: e.message });
      return;
    }
    const email = serviceAccountEmail();
    const hint = e.status === 404 || e.status === 403
      ? ` Share the Drive folder "Statements" with ${email || "the service account"} as Viewer.`
      : "";
    res.status(502).json({ ok: false, error: String(e.message || e) + hint });
  }
}
