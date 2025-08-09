import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// Initialize OpenAI client with API key from .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate SEO metadata for a product using OpenAI
 * @param {{ title: string, description: string, tags: string[] }} product
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateWithOpenAI(product) {
  const { title, description, tags } = product;
  const prompt = `Generate SEO metadata for the following product:
Title: ${title}
Description: ${description}
Tags: ${tags.join(", ")}

Respond with valid JSON following this structure:
{
  "seoTitle": "...",
  "seoDescription": "...",
  "altText": "...",
  "keywords": ["...", "..."]
}
Only return the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });

  const content = response.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON response from OpenAI: ${content}`
    );
  }
}
