export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
    kindNotice: {
      image: "Image generation and edits use the Imagine API and your Grok Build quota. In Example, switch Mode to Image to image and attach up to 3 reference images. You do not need an xAI API key if Grok CLI is already logged in.",
      video: "Video generation uses the Imagine API and your Grok Build quota. You do not need an xAI API key if Grok CLI is already logged in.",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
  },
  models: [
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    { id: "grok-code-fast-1", name: "Grok Code Fast" },
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", params: ["n","response_format","aspect_ratio","resolution"], capabilities: ["edit"], kind: "image" },
    { id: "grok-imagine-image-quality", name: "Grok Imagine Image Quality", params: ["n","response_format","aspect_ratio","resolution"], capabilities: ["edit"], kind: "image" },
    { id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", params: ["n","response_format","aspect_ratio","resolution","quality"], capabilities: ["edit"], kind: "image" },
    { id: "grok-2-image-1212", name: "Grok 2 Image (deprecated)", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-video", name: "Grok Imagine Video", params: ["duration","aspect_ratio","resolution"], kind: "video" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image","video"],
  imageConfig: {
    generationsUrl: "https://api.x.ai/v1/images/generations",
    editsUrl: "https://api.x.ai/v1/images/edits",
    baseUrl: "https://api.x.ai/v1/images/generations",
  },
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  // Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos
  videoConfig: { baseUrl: "https://api.x.ai/v1/videos" },
  searchViaChat: {
    defaultModel: "grok-4.20-reasoning",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
