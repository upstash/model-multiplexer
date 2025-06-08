import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

// Flexible interface for OpenAI-compatible clients
interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (
        params: ChatCompletionCreateParams,
        options?: any
      ) => Promise<any>;
    };
  };
}

interface WeightedModel {
  model: OpenAICompatibleClient;
  weight: number;
  modelName: string;
  // Timestamp until which the model is disabled due to rate limiting
  disabledUntil: number | null;
  // Statistics
  successCount: number;
  rateLimitCount: number;
  failFastCount: number;
}

export class Multiplexer {
  private weightedModels: WeightedModel[] = [];
  private fallbackModels: WeightedModel[] = [];
  private modelTimeouts: Map<string, NodeJS.Timeout> = new Map(); // Store timeout IDs

  constructor() {}

  // Selects an active weighted model entry based on weight
  private _selectWeightedModel(): WeightedModel {
    const now = Date.now();
    // Filter for active models
    const activeModels = this.weightedModels.filter(
      (wm) => wm.disabledUntil === null || wm.disabledUntil < now
    );

    if (activeModels.length === 0) {
      // Check fallback models if all regular models are disabled
      const activeFallbacks = this.fallbackModels.filter(
        (wm) => wm.disabledUntil === null || wm.disabledUntil < now
      );

      if (activeFallbacks.length > 0) {
        // Use the same weighted selection for fallbacks
        const totalFallbackWeight = activeFallbacks.reduce(
          (sum, wm) => sum + wm.weight,
          0
        );

        let randomWeight = Math.random() * totalFallbackWeight;

        for (const fallbackModel of activeFallbacks) {
          randomWeight -= fallbackModel.weight;
          if (randomWeight <= 0) {
            return fallbackModel;
          }
        }

        return activeFallbacks[activeFallbacks.length - 1];
      }

      // Check if there are models but they are all temporarily disabled
      if (this.weightedModels.length > 0 || this.fallbackModels.length > 0) {
        throw new Error("All models are temporarily rate limited.");
      }
      throw new Error("No models available in the multiplexer.");
    }

    // Calculate total weight of active models
    const currentTotalWeight = activeModels.reduce(
      (sum, wm) => sum + wm.weight,
      0
    );

    let randomWeight = Math.random() * currentTotalWeight;

    for (const weightedModel of activeModels) {
      randomWeight -= weightedModel.weight;
      if (randomWeight <= 0) {
        return weightedModel;
      }
    }

    // Fallback (should ideally not be reached with correct logic)
    return activeModels[activeModels.length - 1];
  }

  // Disables a model temporarily
  private _disableModelTemporarily(
    modelName: string,
    durationMs: number
  ): void {
    // Check in primary models first
    let modelIndex = this.weightedModels.findIndex(
      (wm) => wm.modelName === modelName
    );
    let modelArray = this.weightedModels;

    // If not found in primary models, check in fallback models
    if (modelIndex === -1) {
      modelIndex = this.fallbackModels.findIndex(
        (wm) => wm.modelName === modelName
      );
      modelArray = this.fallbackModels;
    }

    // If model not found in either array, return
    if (modelIndex === -1) return;

    const model = modelArray[modelIndex];
    model.disabledUntil = Date.now() + durationMs;

    // Clear existing timeout for this model if any
    const existingTimeout = this.modelTimeouts.get(modelName);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a new timeout to re-enable the model
    const timeoutId = setTimeout(() => {
      model.disabledUntil = null;
      this.modelTimeouts.delete(modelName);
      console.log(`Model ${modelName} re-enabled after rate limit.`);
    }, durationMs);

    // Store the new timeout ID
    this.modelTimeouts.set(modelName, timeoutId);
    console.log(
      `Model ${modelName} temporarily disabled for ${
        durationMs / 1000
      }s due to rate limit.`
    );
  }

  // Mimics the OpenAI client structure
  public readonly chat: {
    completions: {
      create: (
        params: ChatCompletionCreateParams,
        options?: {
          timeout?: number;
          maxRetries?: number;
          signal?: AbortSignal;
          idempotencyKey?: string;
          stream?: boolean;
          headers?: Record<string, string>;
          defaultHeaders?: Record<string, string>;
          defaultQuery?: Record<string, string>;
          responseFormat?: "json" | "text";
          baseURL?: string;
        }
      ) => Promise<
        Awaited<
          ReturnType<OpenAICompatibleClient["chat"]["completions"]["create"]>
        >
      >;
    };
  } = {
    completions: {
      create: async (
        params,
        options?: {
          timeout?: number;
          maxRetries?: number;
          signal?: AbortSignal;
          idempotencyKey?: string;
          stream?: boolean;
          headers?: Record<string, string>;
          defaultHeaders?: Record<string, string>;
          defaultQuery?: Record<string, string>;
          responseFormat?: "json" | "text";
          baseURL?: string;
        }
      ): Promise<
        Awaited<
          ReturnType<OpenAICompatibleClient["chat"]["completions"]["create"]>
        >
      > => {
        let lastError: Error | null = null;

        while (true) {
          let selected: WeightedModel;
          try {
            // Attempt to select an available model
            selected = this._selectWeightedModel();
          } catch (selectionError) {
            // If model selection fails (e.g., all rate limited or no models configured)
            if (lastError) {
              // If we previously caught a 429, throw that error as all retries failed
              throw lastError;
            }
            // Otherwise, re-throw the selection error (no models available/configured)
            throw selectionError;
          }

          const finalParams: ChatCompletionCreateParams = {
            ...params,
            model: selected.modelName, // Use the specific model name associated with the client
          };

          try {
            // Attempt the API call
            const result = await selected.model.chat.completions.create(
              finalParams,
              options
            );
            selected.successCount++; // Increment success count
            return result;
          } catch (error: any) {
            // Check if abort signal is triggered
            if (options?.signal?.aborted) {
              throw new Error("Request aborted");
            }

            // Check if it's a rate limit error (429 or 529)
            if (
              error &&
              typeof error === "object" &&
              "status" in error &&
              (error.status === 429 || error.status === 529)
            ) {
              console.warn(
                `Model ${selected.modelName} hit rate limit. Trying next model.`
              );
              selected.rateLimitCount++; // Increment rate limit count
              this._disableModelTemporarily(selected.modelName, 60 * 1000); // Disable for 1 minute
              lastError =
                error instanceof Error ? error : new Error(String(error)); // Store the 429 error
              continue; // Continue the loop to try another model
            } else {
              selected.failFastCount++; // Increment fail-fast count
              // For any other error, re-throw immediately
              console.error(
                `Error in Multiplexer: ${selected.modelName}`,
                error
              );
              throw error;
            }
          }
        }
      },
    },
  };

  addModel(
    model: OpenAICompatibleClient,
    weight: number,
    modelName: string
  ): void {
    if (!Number.isInteger(weight) || weight <= 0) {
      throw new Error("Weight must be a positive integer.");
    }
    if (!modelName || typeof modelName !== "string") {
      throw new Error("modelName must be a non-empty string.");
    }
    if (
      this.weightedModels.some((wm) => wm.modelName === modelName) ||
      this.fallbackModels.some((wm) => wm.modelName === modelName)
    ) {
      console.warn(
        `Attempted to add a model with the same name '${modelName}' multiple times. Skipping.`
      );
      return;
    }
    // Add model with disabledUntil initialized to null and stats to 0
    this.weightedModels.push({
      model,
      weight,
      modelName,
      disabledUntil: null,
      successCount: 0,
      rateLimitCount: 0,
      failFastCount: 0,
    });
  }

  addFallbackModel(
    model: OpenAICompatibleClient,
    weight: number,
    modelName: string
  ): void {
    if (!Number.isInteger(weight) || weight <= 0) {
      throw new Error("Weight must be a positive integer.");
    }
    if (!modelName || typeof modelName !== "string") {
      throw new Error("modelName must be a non-empty string.");
    }
    if (
      this.weightedModels.some((wm) => wm.modelName === modelName) ||
      this.fallbackModels.some((wm) => wm.modelName === modelName)
    ) {
      console.warn(
        `Attempted to add a model with the same name '${modelName}' multiple times. Skipping.`
      );
      return;
    }
    // Add fallback model with disabledUntil initialized to null and stats to 0
    this.fallbackModels.push({
      model,
      weight,
      modelName,
      disabledUntil: null,
      successCount: 0,
      rateLimitCount: 0,
      failFastCount: 0,
    });
  }

  reset(): void {
    // Clear all pending timeouts
    this.modelTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.modelTimeouts.clear();
    // Reset model lists
    this.weightedModels = [];
    this.fallbackModels = [];
  }

  getStats(): Record<
    string,
    { success: number; rateLimited: number; failed: number }
  > {
    const stats: Record<
      string,
      { success: number; rateLimited: number; failed: number }
    > = {};
    for (const wm of [...this.weightedModels, ...this.fallbackModels]) {
      stats[wm.modelName] = {
        success: wm.successCount,
        rateLimited: wm.rateLimitCount,
        failed: wm.failFastCount,
      };
    }
    return stats;
  }
}
