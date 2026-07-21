export const toNumberOrFallback = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseEmbedding = (rawEmbedding) => {
  if (Array.isArray(rawEmbedding)) return rawEmbedding;

  if (Buffer.isBuffer(rawEmbedding)) {
    try {
      return JSON.parse(rawEmbedding.toString("utf-8"));
    } catch {
      return null;
    }
  }

  if (typeof rawEmbedding === "string") {
    try {
      return JSON.parse(rawEmbedding);
    } catch {
      return null;
    }
  }

  return null;
};

const dotProduct = (a, b) => {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
};

const magnitude = (arr) =>
  Math.sqrt(arr.reduce((sum, value) => sum + value * value, 0));

export const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length || a.length === 0) return 0;
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  const result = dotProduct(a, b) / (magA * magB);
  return Number.isFinite(result) ? result : 0;
};
