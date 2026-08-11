import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { accessibleStudentIds } from "../../../../lib/services/mini-sync-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const allowed = await accessibleStudentIds(access), requested = Number(new URL(request.url).searchParams.get("studentId") || 0), studentId = requested || allowed[0] || 0;
  if (!studentId || !allowed.includes(studentId)) return Response.json({ error: "尚未绑定学生或无权查看该学生" }, { status: 403 });
  const rows = await env.DB.prepare(`SELECT n.id,n.title,n.content,n.audience_role AS audienceRole,n.published_at AS publishedAt,c.name AS className,nr.read_at AS readAt,nr.acknowledged_at AS acknowledgedAt
    FROM class_notices n JOIN classes c ON c.id=n.class_id JOIN enrollments e ON e.class_id=n.class_id AND e.student_id=? AND e.status='active'
    LEFT JOIN notice_receipts nr ON nr.notice_id=n.id AND nr.account_id=? AND nr.student_id=?
    WHERE n.status='published' AND (n.audience_role='both' OR n.audience_role=?) ORDER BY n.published_at DESC,n.id DESC LIMIT 100`).bind(studentId, access.accountId, studentId, access.role).all<Record<string, unknown>>();
  return Response.json({ studentId, notices: rows.results, counts: { total: rows.results.length, unread: rows.results.filter((item) => !item.readAt).length, unacknowledged: rows.results.filter((item) => !item.acknowledgedAt).length } }, { headers: { "Cache-Control": "private, no-store" } });
}
