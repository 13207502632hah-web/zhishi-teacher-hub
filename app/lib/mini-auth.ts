import { env } from "cloudflare:workers";
export type MiniAccess={accountId:number;role:"teacher"|"student"|"parent";studentId:number|null;userId:number|null};
export async function miniTokenHash(token:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,"0")).join("")}
export async function requireMini(request:Request,roles?:MiniAccess["role"][]):Promise<MiniAccess|Response>{const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";if(!token)return Response.json({error:"请先登录小程序"},{status:401});const hash=await miniTokenHash(token),row=await env.DB.prepare("SELECT wa.id AS accountId,wa.role,wa.student_id AS studentId,wa.user_id AS userId FROM mini_sessions ms JOIN wechat_accounts wa ON wa.id=ms.account_id WHERE ms.token_hash=? AND ms.expires_at>CURRENT_TIMESTAMP AND wa.status='active'").bind(hash).first<MiniAccess>();if(!row)return Response.json({error:"登录已过期"},{status:401});if(roles&&!roles.includes(row.role))return Response.json({error:"当前身份无权执行此操作"},{status:403});return row}
export const miniDenied=(value:MiniAccess|Response):value is Response=>value instanceof Response;

