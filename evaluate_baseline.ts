import { analyzeComment } from "./src/index.js";
import fs from "fs";

async function main() {
  const data = JSON.parse(fs.readFileSync("benchmark.json", "utf8"));
  let correct = 0;
  const disagreements = [];
  const metrics: Record<string, { tp: number, fp: number, fn: number }> = {
    POSITIVE: { tp: 0, fp: 0, fn: 0 },
    NEGATIVE: { tp: 0, fp: 0, fn: 0 },
    NEUTRAL: { tp: 0, fp: 0, fn: 0 },
    MIXED: { tp: 0, fp: 0, fn: 0 },
    SPAM: { tp: 0, fp: 0, fn: 0 },
    TOXIC: { tp: 0, fp: 0, fn: 0 }
  };

  for (const item of data) {
    const { label, score, confidence, reasoning } = await analyzeComment(item.text);
    if (label === item.expected) {
      correct++;
      metrics[item.expected].tp++;
    } else {
      metrics[label].fp++;
      metrics[item.expected].fn++;
      disagreements.push({ text: item.text, expected: item.expected, predicted: label, confidence, reasoning });
    }
  }

  console.log(`Overall Accuracy: ${(correct / data.length * 100).toFixed(1)}%`);
  let totalF1 = 0;
  let classes = 0;
  for (const [cls, m] of Object.entries(metrics)) {
    const precision = m.tp / (m.tp + m.fp) || 0;
    const recall = m.tp / (m.tp + m.fn) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;
    if (m.tp + m.fn > 0) {
      totalF1 += f1;
      classes++;
      console.log(`${cls} - P: ${(precision*100).toFixed(1)}%, R: ${(recall*100).toFixed(1)}%, F1: ${(f1*100).toFixed(1)}%, Support: ${m.tp + m.fn}`);
    }
  }
  console.log(`Macro F1: ${(totalF1 / classes * 100).toFixed(1)}%`);
  
  fs.writeFileSync("disagreements.json", JSON.stringify(disagreements, null, 2));
}

main().catch(console.error);
