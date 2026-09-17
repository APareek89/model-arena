export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({
    needsKey: Boolean(process.env.APP_ACCESS_KEY),
    hf: Boolean(process.env.HF_TOKEN),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
}
