import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT es.id,es.published_at AS publishedAt,sv.text_content AS textContent,a.title FROM excellent_submissions es JOIN submission_versions sv ON sv.id=es.submission_version_id JOIN assignment_submissions s ON s.id=sv.submission_id JOIN assignments a ON a.id=s.assignment_id WHERE es.published_at IS NOT NULL AND es.masking_status='confirmed' ORDER BY es.published_at DESC").all();
  return Response.json({ items: rows.results });
}
