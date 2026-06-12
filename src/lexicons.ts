export const idLexicon: Record<string, number> = {
  bagus: 3, baik: 2, mantap: 4, keren: 4, suka: 3, cinta: 4, terbaik: 5, 
  top: 4, hebat: 4, seru: 3, membantu: 3, makasih: 3, terimakasih: 3, 
  jelek: -3, buruk: -3, benci: -4, parah: -3, sampah: -5, bodoh: -4, 
  goblok: -5, tolol: -5, anjing: -5, kecewa: -4, payah: -3, malas: -2, males: -2,
  gagal: -3, menarik: 3, kocak: 3, lucu: 3, ngakak: 3, bosan: -3, 
  ngebosenin: -3, norak: -3, alay: -2, paham: 2, ngerti: 2, bingung: -2, 
  pusing: -2, hoax: -4, bohong: -4, penipu: -5, gila: 4, asik: 3, asyik: 3, muntah: -4,
  burik: -3, cempreng: -2, nyesel: -4, "bertele-tele": -3, edukatif: 3,
  inspirasi: 3, ilmunya: 2, semangat: 3, clickbait: -4, informatif: 3,
  gak_jelas: -3, gak_lucu: -3, gak_sesuai: -3, tidak_jelas: -3, tidak_lucu: -3, tidak_sesuai: -3,
  gak_ada: -2, "buang-buang": -3, terburuk: -5, buang: -2, waktu: 0,
  garing: -2, ngeselin: -3, luar_biasa: 5, keren_parah: 5,
  tidak_bagus: -3, tidak_baik: -2, tidak_mantap: -3, tidak_keren: -3, tidak_suka: -3,
  tidak_menarik: -3, tidak_kocak: -2, tidak_seru: -3, tidak_membantu: -3,
  tidak_paham: -2, tidak_ngerti: -2, tidak_jelek: 3, tidak_buruk: 3, tidak_kecewa: 2,
  membosankan: -3, mahal: -2, kecil: -1, tunggu: 2, menginspirasi: 3, pemula: 1, boong: -3, 
  rombeng: -3, turu: -2, sayang: -1, sayangnya: -2,
  wonderful: 3, terrible: -3
};

export const toxicLexicon: Set<string> = new Set([
  "anjing", "babi", "bangsat", "kontol", "memek", "ngentot", "goblok", "tolol", "idiot", "sampah", "bajingan", "perek", "pelacur", "pantek", "kimak", "pukimak"
]);

export const slangDict: Record<string, string> = {
  "bgt": "banget", "bgttt": "banget",
  "ngab": "bang",
  "bg": "bang",
  "yg": "yang",
  "dgn": "dengan",
  "kalo": "kalau",
  "klo": "kalau",
  "pdhl": "padahal",
  "tp": "tapi",
  "krn": "karena",
  "jgn": "jangan",
  "gw": "saya",
  "gue": "saya",
  "lu": "kamu",
  "loe": "kamu",
  "njir": "anjing",
  "anjir": "anjing",
  "gak": "tidak",
  "ga": "tidak",
  "ngga": "tidak"
};

export const spamKeywords: string[] = [
  "subs", "cek channel", "bio saya", "subscribe", "mampir", "follback", "profilku"
];
