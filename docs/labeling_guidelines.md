# Sentiment Labeling Guidelines

## 1. Label Precedence
Labels must be applied in the following strict precedence order:
1. **TOXIC**: Contains profanity, severe insults, hate speech, or severe toxicity (e.g., "goblok", "anjing", "sampah"). If a comment contains both toxic words and sentiment, it must be labeled `TOXIC`.
2. **SPAM**: Contains promotional links, requests for subscriptions ("subs"), self-promotion, or irrelevant scam links.
3. **MIXED**: Contains explicitly contrasting sentiments about different aspects of the video (e.g., "Kualitas bagus tapi harga mahal"). Also applies to sarcasm where positive words are used to convey negative meaning (e.g., "Bagus banget sampe pengen muntah").
4. **POSITIVE**: Expresses general approval, praise, or positive emotion.
5. **NEGATIVE**: Expresses general disapproval, criticism, or negative emotion.
6. **NEUTRAL**: Statements of fact, questions, timestamps, or observations without polarity (e.g., "Durasi videonya 10 menit", "Kamera apa yang dipake?").

## 2. Tightened Boundary: Neutral vs. Weak Polarity
A comment is **NEUTRAL** if it states an objective fact or asks a question, even if the topic itself might imply something positive or negative. 
- "Saya sedang menonton video ini" -> NEUTRAL.
- "Hehe" -> NEUTRAL (weak laughter without explicit praise).
- "Hadir" -> NEUTRAL.
- "Lumayan lah buat pemula" -> POSITIVE (contains "lumayan", which is a weak positive polarity).

## 3. Handling Sarcasm and Irony
Sarcasm is typically labeled as **MIXED** if it combines positive phrasing with negative intent, or **NEGATIVE** if the negative intent is unambiguous without contrasting aspects.
- "Bagus banget sampe pengen muntah" -> MIXED/NEGATIVE. We will strictly label this as **NEGATIVE** going forward because the *intent* is purely negative, despite the word "Bagus".
- "Keren tapi ngeselin" -> MIXED (two distinct contrasting emotions).

## 4. Updates from Audit
- Fixed "Konten sampah!" from NEGATIVE to TOXIC due to the strict precedence rule (contains toxic word "sampah").
- Fixed "Hehe" to NEUTRAL as it lacks clear positive polarity.
- Fixed "Bagus banget sampe pengen muntah" to NEGATIVE instead of MIXED because the overall sentiment intent is purely negative, not mixed aspect.
