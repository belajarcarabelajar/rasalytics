import { z } from "zod";

const AnalyzeVideoSchema = z.object({
  videoId: z.string().min(1, "Missing videoId"),
  maxPages: z.number().int().min(1).max(10).optional().default(1),
});

try {
  const jsonBody = {};
  const parsedBody = AnalyzeVideoSchema.safeParse(jsonBody);
  if (!parsedBody.success) {
    const errorMessage = parsedBody.error.errors.map((e) => e.message).join(", ");
    console.log("Error:", errorMessage);
  }
} catch (e) {
  console.log("Caught:", e.message);
}
