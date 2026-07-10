import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { classes } from "../../../db/schema";
export async function GET(){return Response.json({ classes: await getDb().select().from(classes).orderBy(desc(classes.createdAt)) });}
export async function POST(request: Request){const p=await request.json() as Record<string,string>; if(!p.name||!p.stage||!p.grade)return Response.json({error:"班级名称、学段、年级为必填项"},{status:400}); const [row]=await getDb().insert(classes).values({name:p.name,stage:p.stage,grade:p.grade,courseType:p.courseType||"一对多",startDate:p.startDate||null,schedule:p.schedule||"",notes:p.notes||""}).returning(); return Response.json({class:row},{status:201});}
