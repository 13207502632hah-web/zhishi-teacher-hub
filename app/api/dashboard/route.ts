import { env } from "cloudflare:workers";
import {isDenied,requirePermission} from "../../lib/access";

export async function GET(){
 const access=await requirePermission("dashboard:read");if(isDenied(access))return access;
 const db=env.DB; const today=new Date().toISOString().slice(0,10); const monday=new Date();monday.setDate(monday.getDate()-((monday.getDay()+6)%7));const week=monday.toISOString().slice(0,10);
 const results=await db.batch([
  db.prepare("SELECT COUNT(*) AS count FROM lessons WHERE date >= ?").bind(week),
  db.prepare("SELECT COUNT(*) AS count FROM lessons WHERE status = 'draft'"),
  db.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status = 'confirmed' AND confirmed_at >= ?").bind(week),
  db.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status = 'draft'"),
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS done FROM attendance"),
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions"),
  db.prepare("SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.mode,l.location,l.online_link AS onlineLink,l.status,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=? ORDER BY l.start_time").bind(today),
  db.prepare("SELECT COUNT(*) AS count FROM assignment_submissions WHERE status != 'completed'"),
  db.prepare("SELECT COUNT(*) AS count FROM student_lesson_records WHERE risk_confirmed = 1"),
  db.prepare("SELECT s.id,s.name,s.grade,r.risk_tags AS riskTags FROM student_lesson_records r JOIN students s ON s.id=r.student_id WHERE r.risk_confirmed=1 ORDER BY r.updated_at DESC LIMIT 5"),
  db.prepare("SELECT r.id,r.date,substr(COALESCE(NULLIF(r.effective_practices,''),r.next_action),1,90) AS summary,l.topic FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id ORDER BY r.updated_at DESC LIMIT 3"),
  db.prepare("SELECT id,substr(stem,1,90) AS stem,status,updated_at AS updatedAt FROM questions ORDER BY updated_at DESC LIMIT 4"),
 ]);
 const n=(i:number,key="count")=>Number((results[i].results[0] as Record<string,unknown>|undefined)?.[key]||0), rate=(i:number)=>{const total=n(i,"total");return total?Math.round(n(i,"done")/total*100):null};
 return Response.json({weekLessons:n(0),draftLessons:n(1),confirmedFeedback:n(2),pendingFeedback:n(3),attendanceRate:rate(4),homeworkRate:rate(5),todayLessons:results[6].results,pendingHomework:n(7),riskCount:n(8),riskStudents:results[9].results,recentReflections:access.role==="teacher"?results[10].results:[],recentQuestions:results[11].results});
}
