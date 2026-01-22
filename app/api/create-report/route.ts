import { POST as createReport } from "../reports/route";

export async function GET(req: Request) {
  return createReport(req);
}

export async function POST(req: Request) {
  return createReport(req);
}
