import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { resolveOpenAICompatibleApiType } from "open-sse/services/provider.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { resolveXaiMediaCredentials } from "../services/xaiMediaCredentials.js";
import { mapXaiMediaErrorMessage, rewriteXaiMediaErrorResponse, XAI_MEDIA_ERRORS } from "../services/xaiMediaErrors.js";
import * as log from "../utils/logger.js";

// Providers that don't require credentials (noAuth)
const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);

// Creation is billable — only rotate for errors that reject BEFORE an image is made.
const IMAGE_CREATE_ROTATION_STATUSES = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.PAYMENT_REQUIRED,
  HTTP_STATUS.RATE_LIMITED,
]);

/**
 * Handle image generation request
 * @param {Request} request
 */
export async function handleImageGeneration(request) {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Use POST /v1/images/edits for multipart image edits");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model;

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[modelStr]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("IMAGE", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelImage(b, m, { wantsStream, binaryOutput, preferredConnectionId }),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelImage(body, modelStr, { wantsStream, binaryOutput, preferredConnectionId });
}

export async function handleSingleModelImage(body, modelStr, { wantsStream, binaryOutput, preferredConnectionId } = {}) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;

  if (isOpenAICompatibleProvider(provider)) {
    const node = await getProviderNodeById(provider);
    const apiType = resolveOpenAICompatibleApiType(provider, { providerSpecificData: node || {} });
    if (apiType !== "images") {
      const prefix = node?.prefix || provider;
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Provider '${prefix}' is a chat node. Use POST /v1/chat/completions.`
      );
    }
  }

  // noAuth providers — no credential needed
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: null,
      binaryOutput,
    });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  // Credentialed providers — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  const isXaiMedia = provider === "xai";

  while (true) {
    const credentials = isXaiMedia
      ? await resolveXaiMediaCredentials("image", { excludeConnectionIds, model, preferredConnectionId })
      : await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(
          HTTP_STATUS.BAD_REQUEST,
          isXaiMedia ? XAI_MEDIA_ERRORS.NO_CREDENTIALS : `No credentials for provider: ${provider}`
        );
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshProvider = credentials.sourceProvider || provider;
    const refreshedCredentials = await checkAndRefreshToken(refreshProvider, credentials);

    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      streamToClient: wantsStream,
      binaryOutput,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) return result.response;

    if (result.reachedUpstream !== true) {
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId, result.status, result.error, refreshProvider, model
    );

    const mapped = isXaiMedia
      ? mapXaiMediaErrorMessage({
          status: result.status,
          sourceProvider: refreshProvider,
          authType: credentials.authType,
        })
      : null;
    const publicError = mapped || result.error;

    if (shouldFallback && IMAGE_CREATE_ROTATION_STATUSES.has(result.status)) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = publicError;
      lastStatus = result.status;
      continue;
    }

    if (isXaiMedia) return rewriteXaiMediaErrorResponse(result, credentials);
    return result.response;
  }
}
