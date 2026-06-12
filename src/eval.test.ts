import { expect, test } from "bun:test";
import { analyzeComment } from "./index";
import fs from "fs";

test("Benchmark Macro F1 Score", async () => {
  const benchmarkData = JSON.parse(fs.readFileSync("./benchmark.json", "utf-8"));
  let correct = 0;
  
  const metrics: Record<string, { tp: number, fp: number, fn: number }> = {
    POSITIVE: { tp: 0, fp: 0, fn: 0 },
    NEGATIVE: { tp: 0, fp: 0, fn: 0 },
    NEUTRAL: { tp: 0, fp: 0, fn: 0 },
    MIXED: { tp: 0, fp: 0, fn: 0 },
    SPAM: { tp: 0, fp: 0, fn: 0 },
    TOXIC: { tp: 0, fp: 0, fn: 0 }
  };

  const LABELS = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED", "SPAM", "TOXIC"];
  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const actual of LABELS) {
    confusionMatrix[actual] = {};
    for (const predicted of LABELS) {
      confusionMatrix[actual][predicted] = 0;
    }
  }

  for (const item of benchmarkData) {
    const { label } = await analyzeComment(item.text);
    
    if (!confusionMatrix[item.expected]) confusionMatrix[item.expected] = {};
    if (confusionMatrix[item.expected][label] === undefined) confusionMatrix[item.expected][label] = 0;
    confusionMatrix[item.expected][label]++;

    if (label === item.expected) {
      correct++;
      metrics[item.expected].tp++;
    } else {
      metrics[label].fp++;
      metrics[item.expected].fn++;
    }
  }

  console.log(`\n--- BENCHMARK RESULTS ---`);
  let totalF1 = 0;
  let weightedF1Sum = 0;
  let classes = 0;
  const totalSamples = benchmarkData.length;

  for (const [cls, data] of Object.entries(metrics)) {
    const precision = data.tp / (data.tp + data.fp) || 0;
    const recall = data.tp / (data.tp + data.fn) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;
    const support = data.tp + data.fn;

    if (support > 0) {
      totalF1 += f1;
      weightedF1Sum += f1 * support;
      classes++;
      console.log(`[${cls.padEnd(8)}] P: ${(precision*100).toFixed(1)}% | R: ${(recall*100).toFixed(1)}% | F1: ${(f1*100).toFixed(1)}% | Support: ${support}`);
    }
  }

  const accuracy = correct / totalSamples;
  const macroF1 = totalF1 / classes;
  const weightedF1 = weightedF1Sum / totalSamples;
  
  console.log(`\nMetrics Summary:`);
  console.log(`- Overall Accuracy : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`- Macro F1 Score   : ${(macroF1 * 100).toFixed(1)}%`);
  console.log(`- Weighted F1 Score: ${(weightedF1 * 100).toFixed(1)}%`);

  console.log(`\n--- CONFUSION MATRIX ---`);
  console.log(`(Row = Actual, Column = Predicted)`);
  const header = "         " + LABELS.map(l => l.substring(0, 3).padStart(5)).join(" ");
  console.log(header);
  for (const actual of LABELS) {
    let rowStr = actual.padEnd(8) + " ";
    for (const predicted of LABELS) {
      rowStr += confusionMatrix[actual][predicted].toString().padStart(5) + " ";
    }
    console.log(rowStr);
  }
  
  expect(macroF1).toBeGreaterThan(0.50); 
});
