import { emojiEmotion } from "emoji-emotion";

export const emojiMap = new Map((emojiEmotion as any[]).map((e) => [e.emoji, ` ${e.name} `]));
const emojis = (emojiEmotion as any[]).map((e) => e.emoji);
// Sort by length before escaping to be precise
emojis.sort((a, b) => b.length - a.length);
const escapedEmojis = emojis.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

export const emojiRegexFastUni = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]|☹️|❤️|☺️|☠️|✌️/u;
export const emojiRegexReplace = new RegExp(`(?:${escapedEmojis.join("|")})`, "g");
