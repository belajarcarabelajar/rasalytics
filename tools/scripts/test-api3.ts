import { z } from "zod";

const AnalyzeVideoSchema = z.object({
  videoId: z.string().min(1, "Missing videoId"),
  maxPages: z.number().int().min(1).max(10).optional().default(1),
});

const jsonBody = {};
const parsedBody = AnalyzeVideoSchema.safeParse(jsonBody);
