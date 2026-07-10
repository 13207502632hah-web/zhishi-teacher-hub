import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { students } from "../../../db/schema";
export async function GET(){return Response.json({ students: await getDb().select().from(students).orderBy(desc(students.createdAt)) });}
export async function POST(request: Request){const p=await request.json() as Record<string,string>; if(!p.name||!p.grade)return Response.json({error:"姓名与年级为必填项"},{status:400}); const [row]=await getDb().insert(students).values({name:p.name,nickname:p.nickname||"",grade:p.grade,foundationLevel:p.foundationLevel||"",weakKnowledge:p.weakKnowledge||"",stageGoal:p.stageGoal||"",notes:p.notes||""}).returning(); return Response.json({student:row},{status:201});}
