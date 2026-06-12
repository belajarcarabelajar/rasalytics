import fs from "fs";

const data = JSON.parse(fs.readFileSync("benchmark.json", "utf8"));

for (const item of data) {
  if (item.text === "Konten sampah!") item.expected = "TOXIC";
  if (item.text === "Bagus banget sampe pengen muntah") item.expected = "NEGATIVE";
}

// Add some hard cases to better represent neutral and mixed and sarcasm
const hardCases = [
  { text: "Bagus sih, tapi boong", expected: "NEGATIVE" },
  { text: "Apakah video ini rilis hari ini?", expected: "NEUTRAL" },
  { text: "Gw nonton ini di kamar mandi", expected: "NEUTRAL" },
  { text: "Gambarnya bagus, suaranya kayak kaleng rombeng", expected: "MIXED" },
  { text: "Keren, sayangnya mahal", expected: "MIXED" },
  { text: "Tolong dong buat video tentang masak", expected: "NEUTRAL" },
  { text: "Anjing keren banget sumpah!", expected: "TOXIC" }, // 'anjing' is toxic in lexicon, so by strict precedence it's TOXIC, even though sentiment is positive
  { text: "Minta link bang", expected: "SPAM" },
  { text: "Mending turu", expected: "NEGATIVE" },
  { text: "B aja", expected: "NEUTRAL" },
  { text: "Biasa", expected: "NEUTRAL" },
  { text: "Wkwkwk", expected: "NEUTRAL" } // Weak polarity, better as Neutral as it's just laughter unless explicit
];

for (const hc of hardCases) {
  if (!data.find((d: any) => d.text === hc.text)) {
    data.push(hc);
  }
}

fs.writeFileSync("benchmark.json", JSON.stringify(data, null, 2));
console.log("Updated benchmark.json with new rules and hard cases. Total items:", data.length);
