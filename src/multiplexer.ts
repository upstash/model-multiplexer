import OpenAI from "openai";
import { APIError } from "openai/error";
import { RequestOptions } from "openai/core";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { Stream } from "openai/streaming";
import {
  ModelConfig,
  ModelMultiplexerConfig,
  ManagedClient,
  ModelStats,
} from "./types"; // Import types

// --- Proxy Class for Chat ---
class ChatProxy {
  // Keep constructor expecting the main multiplexer class
  constructor(private multiplexer: ModelMultiplexer) {}

  public completions = {
    // Define create method with overloads and implementation using an arrow function
    create: ((
      params: ChatCompletionCreateParams,
      options?: RequestOptions
    ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> => {
      // Use arrow function for correct 'this' binding
      if (params.stream) {
        // Type assertion needed for specific parameters expected by the SDK methods
        return this.multiplexer.executeRequestForStream((client: OpenAI) =>
          client.chat.completions.create(
            params as ChatCompletionCreateParamsStreaming,
            options
          )
        );
      } else {
        return this.multiplexer.executeRequest((client: OpenAI) =>
          client.chat.completions.create(
            params as ChatCompletionCreateParamsNonStreaming,
            options
          )
        );
      }
    }) as {
      // Type assertion to satisfy TS about the overloads
      (
        params: ChatCompletionCreateParamsNonStreaming,
        options?: RequestOptions
      ): Promise<ChatCompletion>;
      (
        params: ChatCompletionCreateParamsStreaming,
        options?: RequestOptions
      ): Promise<Stream<ChatCompletionChunk>>;
    },
    // Add other methods under 'completions' if required
  };
  // Add other methods under 'chat' if required (e.g., 'messages')
}

// The main multiplexer class
export class ModelMultiplexer {
  private clients: ManagedClient[];
  private fallbackClients: ManagedClient[];
  private totalWeight: number;
  private totalFallbackWeight: number;

  // Proxy properties for OpenAI sub-APIs
  public readonly chat: ChatProxy; // Use the defined class type

  constructor(config: ModelMultiplexerConfig) {
    const { models, fallbackModels = [] } = config;

    if (!models || models.length === 0) {
      throw new Error("At least one model configuration must be provided.");
    }

    // Store models directly as they are already instantiated
    this.clients = models.map((modelConfig) => ({
      config: modelConfig,
      isRateLimited: modelConfig.isRateLimited || false,
      rateLimitedUntil: modelConfig.rateLimitedUntil,
      isFallback: false,
      // Add stats tracking
      stats: {
        client: this.getClientIdentifier(modelConfig.model),
        model: this.getModelIdentifier(modelConfig.model),
        callCount: 0,
        failedWithRateLimit: 0,
        failedWithAnotherException: 0,
      },
    }));

    // Store fallback models if provided
    this.fallbackClients = fallbackModels.map((modelConfig) => ({
      config: modelConfig,
      isRateLimited: modelConfig.isRateLimited || false,
      rateLimitedUntil: modelConfig.rateLimitedUntil,
      isFallback: true,
      // Add stats tracking
      stats: {
        client: this.getClientIdentifier(modelConfig.model),
        model: this.getModelIdentifier(modelConfig.model),
        callCount: 0,
        failedWithRateLimit: 0,
        failedWithAnotherException: 0,
      },
    }));

    // Initial calculation. Will be updated dynamically.
    this.totalWeight = this.getActiveClients(this.clients).reduce(
      (sum, mc) => sum + mc.config.weight,
      0
    );
    this.totalFallbackWeight = this.getActiveClients(
      this.fallbackClients
    ).reduce((sum, mc) => sum + mc.config.weight, 0);

    if (this.totalWeight <= 0 && this.clients.length > 0) {
      // Warn if all models start inactive, but proceed. It might be intentional.
      console.warn(
        "All initial models have zero or negative weight, or are inactive."
      );
    } else if (this.clients.length === 0) {
      // This case is already handled by the initial check, but kept for clarity.
      throw new Error("No models provided.");
    }

    if (this.fallbackClients.length > 0 && this.totalFallbackWeight <= 0) {
      console.warn(
        "All fallback models have zero or negative weight, or are inactive."
      );
    }

    // Initialize proxies
    this.chat = new ChatProxy(this); // Instantiate the proxy class
  }

  // Helper method to extract client identifier
  private getClientIdentifier(client: OpenAI): string {
    // API key is the most reliable way to identify clients in tests
    if ((client as any).apiKey) {
      return (client as any).apiKey.substring(0, 8);
    }

    // Fall back to other identification methods
    return (client as any).name || "unknown";
  }

  // Helper method to extract model identifier
  private getModelIdentifier(client: OpenAI): string {
    // Try to extract model info from default or custom configuration
    // This is a basic implementation - improve based on actual OpenAI client structure
    return (
      (client as any).defaultQuery?.model ||
      (client as any).defaultHeaders?.["OpenAI-Model"] ||
      "unknown-model"
    );
  }

  // NEW: Public method to get stats for all models
  public getStats(): { models: ModelStats[]; fallbackModels: ModelStats[] } {
    return {
      models: this.clients.map((client) => ({ ...client.stats })),
      fallbackModels: this.fallbackClients.map((client) => ({
        ...client.stats,
      })),
    };
  }

  private getActiveClients(clientList: ManagedClient[]): ManagedClient[] {
    const now = Date.now();
    let weightRecalculated = false;
    const activeClients = clientList.filter((c) => {
      if (c.isRateLimited) {
        if (c.rateLimitedUntil && now >= c.rateLimitedUntil) {
          console.log(`A model's rate limit expired. Re-activating.`);
          c.isRateLimited = false;
          c.rateLimitedUntil = undefined;
          weightRecalculated = true;
          return c.config.weight > 0;
        }
        return false;
      }
      return c.config.weight > 0;
    });

    // Recalculate total weight based on reactivations IN THIS LIST
    if (weightRecalculated) {
      // Instead of determining list type based on the first client,
      // use reference comparison to determine if we're dealing with fallback list
      const isFallbackList = clientList === this.fallbackClients;

      // Calculate weight from the filtered activeClients list
      const newTotalWeight = activeClients.reduce(
        (sum, mc) => sum + mc.config.weight,
        0
      );

      if (isFallbackList) {
        this.totalFallbackWeight = newTotalWeight;
        console.log(
          `Recalculated Fallback Weight: ${this.totalFallbackWeight}`
        ); // Debug log
      } else {
        this.totalWeight = newTotalWeight;
        console.log(`Recalculated Primary Weight: ${this.totalWeight}`); // Debug log
      }
    }
    return activeClients;
  }

  private calculateCurrentTotalWeight(activeClients: ManagedClient[]): number {
    // Calculates weight based on the provided list of *currently* active clients
    return activeClients.reduce(
      (sum, managedClient) => sum + managedClient.config.weight,
      0
    );
  }

  private selectClient(useFallback: boolean = false): ManagedClient | null {
    const clientList = useFallback ? this.fallbackClients : this.clients;
    const activeClients = this.getActiveClients(clientList);
    const currentTotalWeight = this.calculateCurrentTotalWeight(activeClients);

    if (activeClients.length === 0 || currentTotalWeight <= 0) {
      if (!useFallback) {
        return null;
      } else {
        console.warn(
          "No active fallback clients available for selection (weight > 0)."
        );
        return null;
      }
    }

    let randomWeight = Math.random() * currentTotalWeight;
    for (const client of activeClients) {
      if (client.config.weight > 0) {
        if (randomWeight < client.config.weight) {
          return client;
        }
        randomWeight -= client.config.weight;
      }
    }

    // Fallback: If the loop finishes without selection (e.g., float issues), return the first valid client.
    const validAvailableClients = activeClients.filter(
      (c) => c.config.weight > 0
    );
    if (validAvailableClients.length > 0) {
      // Return the FIRST valid client instead of the last
      console.warn(
        "Selection loop finished without selecting based on random weight, returning first valid client."
      );
      return validAvailableClients[0];
    }

    // Should not be reached if currentTotalWeight > 0
    console.error("selectClient reached unexpected end state."); // Added error log
    return null;
  }

  private handleRateLimit(
    rateLimitedClient: ManagedClient,
    retryAfterSeconds: number = 60
  ) {
    // Ensure retryAfterSeconds is a sensible minimum (e.g., 1 second)
    const effectiveRetrySeconds = Math.max(1, retryAfterSeconds);

    console.warn(
      `A model hit rate limit. Deactivating temporarily for ${effectiveRetrySeconds}s.`
    );
    rateLimitedClient.isRateLimited = true;
    rateLimitedClient.rateLimitedUntil =
      Date.now() + effectiveRetrySeconds * 1000;

    // Update rate limit stats
    rateLimitedClient.stats.failedWithRateLimit++;

    // Recalculate total weight of *remaining* active clients immediately
    if (rateLimitedClient.isFallback) {
      this.totalFallbackWeight = this.getActiveClients(
        this.fallbackClients
      ).reduce((sum, mc) => sum + mc.config.weight, 0);
    } else {
      this.totalWeight = this.getActiveClients(this.clients).reduce(
        (sum, mc) => sum + mc.config.weight,
        0
      );
    }
  }

  // Public for ChatProxy access
  public async executeRequest<T>(
    requestFn: (client: OpenAI) => Promise<T>,
    maxAttempts?: number
  ): Promise<T> {
    const maxRetries =
      maxAttempts ?? this.clients.length + this.fallbackClients.length;
    let currentAttempt = 0;
    let lastError: Error | null = null;
    const attemptedClientIdsInCycle = new Set<string>();
    let usingFallback = false;

    while (currentAttempt < maxRetries) {
      currentAttempt++;

      // --- Client Selection Logic ---
      let selectedManagedClient: ManagedClient | null = null;
      let selectionAttempts = 0;
      const maxSelectionAttempts =
        (this.clients.length + this.fallbackClients.length) * 2;

      while (
        !selectedManagedClient &&
        selectionAttempts < maxSelectionAttempts
      ) {
        selectionAttempts++;
        const activePrimary = this.getActiveClients(this.clients);
        if (
          !usingFallback &&
          activePrimary.length === 0 &&
          this.fallbackClients.length > 0
        ) {
          console.log(
            "All primary models are unavailable. Switching to fallback models."
          );
          usingFallback = true;
          attemptedClientIdsInCycle.clear();
        }

        selectedManagedClient = this.selectClient(usingFallback);

        if (!selectedManagedClient) {
          console.warn(
            "All available models are currently rate-limited or inactive. Waiting before potential retry..."
          );
          await this.waitForNextAvailableClient(usingFallback);
          continue;
        }

        // Check if this specific client was already tried in this attempt cycle
        // Use ONLY the fake API key part for ID in tests
        const clientId =
          selectedManagedClient.config.model.apiKey?.substring(0, 8) ||
          "unknown"; // Simpler ID for testing
        if (attemptedClientIdsInCycle.has(clientId)) {
          // We've tried this one recently, try selecting again (might get another)
          selectedManagedClient = null; // Force re-selection
          if (selectionAttempts >= maxSelectionAttempts - 1) {
            console.warn(
              "Potential selection loop detected after trying all clients. Waiting..."
            );
            await this.waitForNextAvailableClient(usingFallback);
          }
          continue;
        }

        // Mark this client as attempted in this cycle
        attemptedClientIdsInCycle.add(clientId);
      }

      // If we exhausted selection attempts without finding a usable client
      if (!selectedManagedClient) {
        lastError = new Error(
          "Failed to select an available model after multiple attempts and waits."
        );
        console.error(lastError.message);
        // Continue to next iteration of main loop, maybe retries left
        continue;
      }

      // --- Request Execution Logic ---
      const modelType = selectedManagedClient.isFallback
        ? "fallback"
        : "primary";
      console.log(
        `Attempt ${currentAttempt}/${maxRetries}: Using a ${modelType} model with weight ${selectedManagedClient.config.weight}`
      );

      try {
        // Increment call counter before making the request
        selectedManagedClient.stats.callCount++;

        const result = await requestFn(selectedManagedClient.config.model);
        // Explicitly return on success
        return result;
      } catch (error) {
        lastError = error as Error; // Always capture the latest error
        if (error instanceof APIError && error.status === 429) {
          console.warn(`A ${modelType} model hit rate limit (APIError 429).`);
          const retryAfterHeader = error.headers?.["retry-after"];
          let retryAfterSeconds = 60; // Default wait
          if (retryAfterHeader) {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds)) {
              retryAfterSeconds = parsedSeconds;
            } else {
              try {
                const retryDate = new Date(retryAfterHeader);
                const diffSeconds = Math.ceil(
                  (retryDate.getTime() - Date.now()) / 1000
                );
                if (diffSeconds > 0) {
                  retryAfterSeconds = diffSeconds;
                }
              } catch (dateParseError) {
                console.warn(
                  "Could not parse Retry-After header:",
                  retryAfterHeader
                );
              }
            }
          }
          this.handleRateLimit(selectedManagedClient, retryAfterSeconds);

          // Clear attempted set if cycle exhausted
          const currentClientList = usingFallback
            ? this.fallbackClients
            : this.clients;
          if (
            attemptedClientIdsInCycle.size >=
            this.getActiveClients(currentClientList).length
          ) {
            console.log("Tried all available clients in this cycle.");
            attemptedClientIdsInCycle.clear();
          }
          // Continue to the next attempt iteration
          continue;
        } else {
          console.error(`Request failed with non-recoverable error:`, error);
          // Track other exception
          selectedManagedClient.stats.failedWithAnotherException++;
          // Non-recoverable error - throw immediately to stop the process
          throw error;
        }
      }
    } // End of while loop

    // If the loop completes without returning (success) or throwing (non-429 error),
    // it means we exhausted retries due to rate limits. Throw the last captured error.
    throw new Error(
      `Failed to complete the request after trying ${maxRetries} attempts across available models. Last error: ${
        lastError?.message || "Unknown error after exhausting retries"
      }`
    );
  }

  // Public for ChatProxy access - Needs similar logic refinement for attempts
  public async executeRequestForStream(
    requestFn: (client: OpenAI) => Promise<Stream<ChatCompletionChunk>>,
    maxAttempts?: number
  ): Promise<Stream<ChatCompletionChunk>> {
    const maxRetries =
      maxAttempts ?? this.clients.length + this.fallbackClients.length;
    let currentAttempt = 0;
    let lastError: Error | null = null;
    const attemptedClientIdsInCycle = new Set<string>();
    let usingFallback = false;

    while (currentAttempt < maxRetries) {
      currentAttempt++;

      // --- Client Selection Logic (similar to executeRequest) ---
      let selectedManagedClient: ManagedClient | null = null;
      let selectionAttempts = 0;
      const maxSelectionAttempts =
        (this.clients.length + this.fallbackClients.length) * 2;

      while (
        !selectedManagedClient &&
        selectionAttempts < maxSelectionAttempts
      ) {
        selectionAttempts++;
        const activePrimary = this.getActiveClients(this.clients);
        if (
          !usingFallback &&
          activePrimary.length === 0 &&
          this.fallbackClients.length > 0
        ) {
          console.log(
            "All primary models unavailable for streaming. Switching to fallback models."
          );
          usingFallback = true;
          attemptedClientIdsInCycle.clear();
        }

        selectedManagedClient = this.selectClient(usingFallback);

        if (!selectedManagedClient) {
          console.warn(
            "All available models rate-limited/inactive (stream). Waiting..."
          );
          await this.waitForNextAvailableClient(usingFallback);
          continue;
        }

        // Check if this specific client was already tried in this attempt cycle
        // Use ONLY the fake API key part for ID in tests
        const clientId =
          selectedManagedClient.config.model.apiKey?.substring(0, 8) ||
          "unknown";
        if (attemptedClientIdsInCycle.has(clientId)) {
          selectedManagedClient = null;
          if (selectionAttempts >= maxSelectionAttempts - 1) {
            console.warn(
              "Potential selection loop detected (stream). Waiting..."
            );
            await this.waitForNextAvailableClient(usingFallback);
          }
          continue;
        }
        attemptedClientIdsInCycle.add(clientId);
      }

      // If we exhausted selection attempts without finding a usable client
      if (!selectedManagedClient) {
        lastError = new Error(
          "Failed to select an available model for streaming after multiple attempts."
        );
        console.error(lastError.message);
        // Continue to next iteration of main loop
        continue;
      }

      const modelType = selectedManagedClient.isFallback
        ? "fallback"
        : "primary";
      console.log(
        `Attempt ${currentAttempt}/${maxRetries} (stream): Using a ${modelType} model with weight ${selectedManagedClient.config.weight}`
      );

      try {
        // Increment call counter before making the request
        selectedManagedClient.stats.callCount++;

        const stream = await requestFn(selectedManagedClient.config.model);
        // Explicitly return on success
        return stream;
      } catch (error) {
        lastError = error as Error; // Capture latest error
        if (error instanceof APIError && error.status === 429) {
          console.warn(
            `A ${modelType} model hit rate limit (APIError 429, stream).`
          );
          // Same retry-after logic as non-streaming
          const retryAfterHeader = error.headers?.["retry-after"];
          let retryAfterSeconds = 60;
          if (retryAfterHeader) {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds)) {
              retryAfterSeconds = parsedSeconds;
            } else {
              try {
                const retryDate = new Date(retryAfterHeader);
                const diffSeconds = Math.ceil(
                  (retryDate.getTime() - Date.now()) / 1000
                );
                if (diffSeconds > 0) {
                  retryAfterSeconds = diffSeconds;
                }
              } catch (dateParseError) {
                console.warn(
                  "Could not parse Retry-After header:",
                  retryAfterHeader
                );
              }
            }
          }
          this.handleRateLimit(selectedManagedClient, retryAfterSeconds);

          // Clear attempted set if cycle exhausted
          const currentClientList = usingFallback
            ? this.fallbackClients
            : this.clients;
          if (
            attemptedClientIdsInCycle.size >=
            this.getActiveClients(currentClientList).length
          ) {
            console.log("Tried all available clients in this cycle (stream).");
            attemptedClientIdsInCycle.clear();
          }
          // Continue to the next attempt iteration
          continue;
        } else {
          console.error(`Stream request failed initiation:`, error);
          // Track other exception
          selectedManagedClient.stats.failedWithAnotherException++;
          // Non-recoverable error - throw immediately
          throw error;
        }
      }
    } // End of while loop

    // If loop completes, throw final error
    throw new Error(
      `Failed to initiate the stream request after trying ${maxRetries} attempts. Last error: ${
        lastError?.message || "Unknown stream error after exhausting retries"
      }`
    );
  }

  // Helper function to wait until the next client becomes available
  private async waitForNextAvailableClient(
    useFallback: boolean = false
  ): Promise<void> {
    const now = Date.now();
    const clientList = useFallback ? this.fallbackClients : this.clients;
    const waitTimes = clientList
      .filter((c) => c.isRateLimited && c.rateLimitedUntil)
      .map((c) => c.rateLimitedUntil! - now)
      .filter((t) => t > 0);

    if (waitTimes.length === 0) {
      // If no clients are temporarily rate-limited, but still none are selectable
      // (e.g., all have weight 0), wait a default period before checking again.
      console.warn(
        "No clients currently rate-limited, but none are active. Waiting default time."
      );
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Default 5s wait
    } else {
      const minWait = Math.min(...waitTimes);
      const waitSeconds = Math.ceil(minWait / 1000);
      console.log(
        `Waiting for ${waitSeconds} seconds for the next client to become available...`
      );
      await new Promise((resolve) => setTimeout(resolve, minWait + 100)); // Wait + buffer
    }
    // After waiting, trigger client reactivation check
    this.getActiveClients(clientList);
  }

  // Expose a way to update models dynamically if needed
  public updateModels(config: ModelMultiplexerConfig) {
    const { models, fallbackModels = [] } = config;

    if (!models || models.length === 0) {
      throw new Error("Cannot update models with an empty list.");
    }

    // Re-initialize clients
    this.clients = models.map((modelConfig) => ({
      config: modelConfig,
      isRateLimited: modelConfig.isRateLimited || false,
      rateLimitedUntil: modelConfig.rateLimitedUntil,
      isFallback: false,
      // Add stats tracking with default values
      stats: {
        client: this.getClientIdentifier(modelConfig.model),
        model: this.getModelIdentifier(modelConfig.model),
        callCount: 0,
        failedWithRateLimit: 0,
        failedWithAnotherException: 0,
      },
    }));

    // Update fallback clients if provided
    this.fallbackClients = fallbackModels.map((modelConfig) => ({
      config: modelConfig,
      isRateLimited: modelConfig.isRateLimited || false,
      rateLimitedUntil: modelConfig.rateLimitedUntil,
      isFallback: true,
      // Add stats tracking with default values
      stats: {
        client: this.getClientIdentifier(modelConfig.model),
        model: this.getModelIdentifier(modelConfig.model),
        callCount: 0,
        failedWithRateLimit: 0,
        failedWithAnotherException: 0,
      },
    }));

    // Recalculate total weight based on the new set of clients
    this.totalWeight = this.getActiveClients(this.clients).reduce(
      (sum, mc) => sum + mc.config.weight,
      0
    );
    this.totalFallbackWeight = this.getActiveClients(
      this.fallbackClients
    ).reduce((sum, mc) => sum + mc.config.weight, 0);

    console.log("Model configurations updated and clients re-initialized.");
    if (this.totalWeight <= 0 && this.clients.length > 0) {
      console.warn(
        "All updated primary models have zero or negative weight, or are inactive."
      );
    }
    if (this.fallbackClients.length > 0 && this.totalFallbackWeight <= 0) {
      console.warn(
        "All updated fallback models have zero or negative weight, or are inactive."
      );
    }
  }
}
