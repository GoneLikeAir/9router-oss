import { OPENAI_COMPATIBLE_PREFIX } from "./providers.js";

export const OPENAI_COMPATIBLE_API_TYPES = ["chat", "responses", "images"];

function storedApiType(credsOrNode) {
  if (!credsOrNode || typeof credsOrNode !== "object") return undefined;
  return credsOrNode.providerSpecificData?.apiType ?? credsOrNode.apiType;
}

export function resolveCompatibleApiType(providerId, credsOrNode = null) {
  const stored = storedApiType(credsOrNode);
  if (stored === "chat" || stored === "responses" || stored === "images") return stored;
  if (typeof providerId === "string" && providerId.startsWith(`${OPENAI_COMPATIBLE_PREFIX}images-`)) {
    return "images";
  }
  if (typeof providerId === "string" && providerId.includes("responses")) {
    return "responses";
  }
  return "chat";
}

export function isOpenAICompatibleImagesProvider(providerId, credsOrNode = null) {
  return resolveCompatibleApiType(providerId, credsOrNode) === "images";
}

export function compatibleNodeServiceKinds(apiType) {
  return apiType === "images" ? ["image"] : ["llm"];
}
