import ModelMultiplexer, { ModelConfig } from "../src/index";
import OpenAI from "openai";
import "dotenv/config";
// --- Configuration ---
// Create OpenAI client instances for each model you want to use

// PRIMARY MODELS (higher quality, potentially stricter rate limits)
const claudeSonnetModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-7-sonnet-latest" }, // Balanced Claude model
});

// Create primary model configurations with their weights
const primaryModels: ModelConfig[] = [
  {
    model: claudeSonnetModel,
    weight: 3, // Medium weight for Claude Sonnet
  },
];

// --- Initialization ---
console.log("Initializing Model Multiplexer...");
let multiplexer: ModelMultiplexer;

try {
  // Pass both primary and fallback models in the config object
  multiplexer = new ModelMultiplexer({
    models: primaryModels,
  });
  console.log(
    "Model Multiplexer initialized successfully with fallback models."
  );
} catch (error) {
  console.error("Error initializing Model Multiplexer:", error);
  process.exit(1);
}

// --- Basic Usage: Chat Completion ---
async function runChatCompletion() {
  console.log("\nSending chat completion request...");
  try {
    // The model parameter is required by OpenAI's types but will be ignored by the multiplexer
    // It will use the model from the selected client's defaultQuery instead
    const completion = await multiplexer.chat.completions.create({
      model: "does-not-matter", // This model will be ignored by the multiplexer
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the capital of France?" },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    console.log("Chat completion received:");
    console.log(completion.choices[0]?.message?.content);
    console.log("\nUsage stats:", completion.usage);
  } catch (error) {
    console.error("Error during chat completion:", error);
    // Output the selected model when handling errors to verify behavior
    if (error instanceof Error) {
      console.log(
        "Error message contains the model name from the client, not from the API call params:",
        error.message.includes("does-not-matter")
          ? "ISSUE: Still using passed model parameter"
          : "SUCCESS: Using client's defaultQuery model"
      );
    }
  }
}

// --- Example Execution ---
if (require.main === module) {
  // Run the examples
  const run = async () => {
    await runChatCompletion();
    console.log("\nExamples completed.");
  };

  run().catch(console.error);
}
