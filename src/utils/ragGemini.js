import { GoogleGenAI } from "@google/genai";
import { BadRequestError, ServiceUnavailableError } from "./errors/index.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// RAG document & query embeddings share this dimensionality. 768 matches the
// question embeddings (one size across the app), and at ~4x less storage/compute
// than the 3072 default keeps the in-app cosine scan fast. Query and chunk
// vectors MUST use the same value — both functions below read this constant.
const parsedRagDim = Number.parseInt(process.env.RAG_EMBEDDING_DIM, 10);
const RAG_EMBEDDING_DIM =
  Number.isInteger(parsedRagDim) && parsedRagDim > 0 ? parsedRagDim : 768;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export const getDocumentEmbedding = async (text) => {
 
  if (!ai || !GEMINI_API_KEY || typeof GEMINI_API_KEY !== "string") {
    throw new ServiceUnavailableError(
      "AI features are temporarily unavailable because the Gemini API is not configured.",
    );
  }
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: RAG_EMBEDDING_DIM },
  });

  const values = result.embeddings?.[0]?.values ?? result.embeddings?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new BadRequestError("Invalid embedding output from Gemini API");
  }
  return values;
};

export const getQueryEmbedding = async (text) => {
  if (!ai || !GEMINI_API_KEY || typeof GEMINI_API_KEY !== "string") {
    throw new ServiceUnavailableError(
      "AI features are temporarily unavailable because the Gemini API is not configured.",
    );
  }
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: RAG_EMBEDDING_DIM },
  });

  const values = result.embeddings?.[0]?.values ?? result.embeddings?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new BadRequestError("Invalid embedding output from Gemini API");
  }
  return values;
};

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite";

const parseGeminiResponse = (rawText, chunks) => {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch?.[1]) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch (err) {
        // Fallback
      }
    }
  }

  if (!parsed || typeof parsed.answer !== "string") {
    return {
      answer: rawText || "Unable to generate answer from the document.",
      citations: [],
      chunksUsed: [],
    };
  }

  const citations = Array.isArray(parsed.citations) ? parsed.citations : [];
  const chunksUsed = [];
  const validatedCitations = [];

  for (const citation of citations) {
    if (typeof citation.ref === "number" && typeof citation.chunkIndex === "number") {
      const matchedChunk = chunks.find(c => c.chunkIndex === citation.chunkIndex);
      // Attach the source text (and score) so the client can render the
      // reference behind each [n] marker, not just the number.
      validatedCitations.push({
        ref: citation.ref,
        chunkIndex: citation.chunkIndex,
        excerpt: matchedChunk ? matchedChunk.content : null,
        score:
          matchedChunk && typeof matchedChunk.score === "number"
            ? matchedChunk.score
            : null,
      });
      if (matchedChunk && !chunksUsed.includes(matchedChunk.chunkId)) {
        chunksUsed.push(matchedChunk.chunkId);
      }
    }
  }

  return {
    answer: parsed.answer,
    citations: validatedCitations,
    chunksUsed,
  };
};

export const answerFromRagChunksService = async (query, chunks) => {
  if (!GEMINI_API_KEY) {
    throw new BadRequestError("Gemini API key is not configured");
  }

  const chunksContext = chunks
    .map((c, i) => `[${i + 1}] (Chunk Index: ${c.chunkIndex}): ${c.content}`)
    .join("\n\n");

  const prompt = `You are an AI assistant helping a user query a document.
Here are the relevant snippets (context chunks) from the document:

${chunksContext}

Query: ${query}

Instructions:
1. Answer the query using ONLY the context chunks provided above.
2. Do not use any external knowledge.
3. If the context does not contain enough information to answer, state that the information is not available in the document.
4. Provide inline citations in your answer using bracketed numbers corresponding to the source list (e.g. [1], [2]).
5. You must output your response in JSON format matching the following schema:
{
  "answer": "Your answer string with inline citations...",
  "citations": [
    {
      "ref": 1,
      "chunkIndex": 12
    }
  ]
}
Where "ref" is the number in the brackets (e.g., 1 for [1]), and "chunkIndex" is the original chunk index of that source chunk.
Ensure the output is valid JSON and nothing else.`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "";
    return parseGeminiResponse(rawText, chunks);
  } catch (error) {
    throw new Error(`Gemini text generation failed: ${error.message}`);
  }
};
