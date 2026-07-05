import { z } from "zod";

const AnalyzeVideoSchema = z.object({
  videoId: z.string().min(1, "Missing videoId"),
  maxPages: z.number().int().min(1).max(10).optional().default(1),
});

const jsonBody = {};
const parsedBody = AnalyzeVideoSchema.safeParse(jsonBody);
if (!parsedBody.success) {
  console.log("type of error:", typeof parsedBody.error);
  console.log("has errors property:", "errors" in parsedBody.error);
  console.log("has issues property:", "issues" in parsedBody.error);
  if ("issues" in parsedBody.error) console.log(parsedBody.error.issues);
}
