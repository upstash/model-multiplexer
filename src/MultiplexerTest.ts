import { Multiplexer } from "./Multiplexer";
import OpenAI from "openai";

export class MultiplexerTest {
  private multiplexer: Multiplexer;

  constructor() {
    this.multiplexer = new Multiplexer();
  }

  addModel(client: OpenAI, weight: number, modelName: string) {
    this.multiplexer.addModel(client, weight, modelName);
    return this;
  }

  addFallbackModel(client: OpenAI, weight: number, modelName: string) {
    this.multiplexer.addFallbackModel(client, weight, modelName);
    return this;
  }

  async testSimpleAddition(): Promise<boolean> {
    try {
      const message = await this.multiplexer.chat.completions.create({
        model: "placeholder",
        messages: [
          {
            role: "user",
            content: "What is 1+1? Answer with just the number.",
          },
        ],
      });

      if (!("choices" in message)) {
        console.error("Expected ChatCompletion, but received a stream.");
        return false;
      }

      const responseContent =
        message.choices[0]?.message?.content?.trim() || "";
      return responseContent === "2";
    } catch (error) {
      console.error("Error testing multiplexer:", error);
      return false;
    }
  }

  /**
   * Tests a single OpenAI-compatible client and model with a simple addition prompt.
   * @param client An initialized OpenAI or compatible client instance.
   * @param modelName The specific model name to test.
   * @returns True if the model responds correctly with "2", false otherwise.
   */
  static async testSingleModel(
    client: OpenAI,
    modelName: string
  ): Promise<boolean> {
    console.log(`Testing model: ${modelName}...`);
    try {
      const message = await client.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: "user",
            content: "What is 1+1? Answer with just the number.",
          },
        ],
      });

      if (!("choices" in message)) {
        console.error(
          `[${modelName}] Expected ChatCompletion, but received a stream.`
        );
        return false;
      }

      const responseContent =
        message.choices[0]?.message?.content?.trim() || "";
      const result = responseContent === "2";
      console.log(
        `[${modelName}] Response: '${responseContent}'. Correct: ${result}`
      );
      return result;
    } catch (error) {
      console.error(`[${modelName}] Error testing model:`, error);
      return false;
    }
  }
}
