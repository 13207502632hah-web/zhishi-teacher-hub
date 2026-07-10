import { env } from "cloudflare:workers";

export async function GET(){
 const db=env.DB; const today=new Date().toISOString().slice(0,10); const monday=new Date();monday.setDate(monday.getDate()-((monday.getDay()+6)%7));const week=monday.toISOString().slice(0,10);
 const results=await db.batch([
  db.prepare("SELECT COUNT(*) AS count FROM lessons WHERE date >= ?").bind(week),
  db.prepare("SELECT COUNT(*) AS count FROM lessons WHERE status = 'draft'"),
  db.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status = 'confirmed' AND confirmed_at >= ?").bind(week),
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS done FROM attendance"),
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions"),
  db.prepare("SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.mode,l.location,l.online_link AS onlineLink,l.status,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=? ORDER BY l.start_time").bind(today),
  db.prepare("SELECT COUNT(*) AS count FROM assignment_submissions WHERE status != 'completed'"),
  db.prepare("SELECT COUNT(*) AS count FROM student_lesson_records WHERE risk_confirmed = 1"),
  db.prepare("SELECT s.id,s.name,s.grade,r.risk_tags AS riskTags FROM student_lesson_records r JOIN students s ON s.id=r.student_id WHERE r.risk_confirmed=1 ORDER BY r.updated_at DESC LIMIT 5"),
 ]);
 const n=(i:number,key="count")=>Number((results[i].results[0] as Record<string,unknown>|undefined)?.[key]||0), rate=(i:number)=>{const total=n(i,"total");return total?Math.round(n(i,"done")/total*100):null};
 return Response.json({weekLessons:n(0),draftLessons:n(1),confirmedFeedback:n(2),attendanceRate:rate(3),homeworkRate:rate(4),todayLessons:results[5].results,pendingHomework:n(6),riskCount:n(7),riskStudents:results[8].results});
}
