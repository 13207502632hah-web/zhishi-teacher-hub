import { GET as legacySimilar } from "../../../../questions/[id]/similar/route";
export const GET = legacySimilar;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return legacySimilar(request, context); }
