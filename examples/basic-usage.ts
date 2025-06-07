import Multiplexer from "../src/index";
import OpenAI from "openai";

// Note: Set environment variables before running:
// export OPENAI_API_KEY="your-openai-key"
// export ANTHROPIC_API_KEY="your-anthropic-key"
// export GEMINI_API_KEY="your-gemini-key"

// --- Client Configuration ---

const claude = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/",
});

// --- Initialization ---
console.log("Initializing Model Multiplexer...");
const multiplexer = new Multiplexer();

try {
  // Add primary models (more expensive models)
  multiplexer.addModel(claude, 5, "claude-sonnet-4-0");
  multiplexer.addModel(claude, 3, "claude-opus-4-0");
  multiplexer.addModel(gemini, 4, "gemini-2.5-pro-preview-05-06");

  // Add fallback models (cheaper models possibly higher quotas)
  multiplexer.addFallbackModel(openai, 5, "gpt-4.1-mini");
  multiplexer.addFallbackModel(gemini, 3, "gemini-2.0-flash");
} catch (error) {
  console.error("Error initializing Model Multiplexer:", error);
  process.exit(1);
}

async function runChatCompletion() {
  console.log("\nSending chat completion request...");
  try {
    const completion = (await multiplexer.chat.completions.create({
      model: "placeholder", // This will be overridden by the selected model
      messages: [
        { role: "system", content: "You are a funny assistant." },
        { role: "user", content: "Tell me a joke. Max 10 words." },
      ],
      temperature: 0.5,
      max_tokens: 1000,
    })) as OpenAI.Chat.Completions.ChatCompletion;

    console.log("Chat completion received:");
    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error during chat completion:", error);
  }
}

// --- Example Execution ---
if (require.main === module) {
  const run = async () => {
    await runChatCompletion();
    console.log("Model usage stats:", multiplexer.getStats());
    console.log("\nExamples completed.");
  };

  run().catch(console.error);
}
