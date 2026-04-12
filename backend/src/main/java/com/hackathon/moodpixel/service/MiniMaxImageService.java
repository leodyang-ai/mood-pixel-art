package com.hackathon.moodpixel.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Set;

/**
 * MiniMax 文生图 / 图生图（subject_reference），POST {api-base}/v1/image_generation ，Authorization: Bearer。
 */
@Service
public class MiniMaxImageService {

    private static final int PROMPT_MAX_LEN = 1500;

    /**
     * 人像卡通化：严格图生图，避免模型“凭空画新脸”。与官方 I2I 一致 subject_reference.type=character。
     */
    private static final String CARTOON_PORTRAIT_PROMPT = String.join(" ",
            "参考上传图片的主体，生成Q版卡通风格图像。\n" +
                    "保留原图【人物/动物】的核心特征，头部比例放大至身体的1.5倍，五官圆润可爱。\n" +
                    "要求，人物服装配饰和颜色什么的要和原图保持一致\n"+
                    "风格：简约扁平风，无多余线条，色彩饱和度高，背景简洁干净，与原图构图一致。\n" +
                    "禁止改变主体的朝向和动作。");

    /**
     * 官方建议 “Please retry your requests later” 的瞬时错误（含 1033 system error / mysql failed）。
     */
    private static final Set<Integer> RETRYABLE_STATUS_CODES = Set.of(
            1000, 1001, 1002, 1024, 1033, 1039
    );

    private static final Logger log = LoggerFactory.getLogger(MiniMaxImageService.class);

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${minimax.api-key:}")
    private String apiKey;

    @Value("${minimax.api-base:https://api.minimaxi.com}")
    private String apiBase;

    @Value("${minimax.model:image-01}")
    private String model;

    /** 默认值勿写「1:1」，Spring 会把「:」当成占位符分隔符；统一在 application.properties 里配置。 */
    @Value("${minimax.aspect-ratio}")
    private String aspectRatio;

    @Value("${minimax.retry.max-attempts:3}")
    private int maxAttempts;

    /**
     * 根据用户文字构造「表达心情」的提示词，调用 MiniMax 生成图片，返回原始图片字节（PNG/JPEG 等）。
     */
    public byte[] generateMoodImageBytes(String userText) throws Exception {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                    "未配置 MiniMax API Key，请在环境变量 MINIMAX_API_KEY 或 application.properties 中设置 minimax.api-key");
        }

        int attempts = Math.max(1, Math.min(8, maxAttempts));
        String prompt = truncate(buildMoodPrompt(userText), PROMPT_MAX_LEN);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", model);
        body.put("prompt", prompt);
        body.put("aspect_ratio", aspectRatio);
        body.put("response_format", "base64");

        log.info("[MiniMax] 文生图 model={} aspectRatio={} promptLen={} promptPreview={} 最多尝试 {} 次",
                model, aspectRatio, prompt.length(), preview(prompt, 120), attempts);

        return postImageGeneration(body, attempts);
    }

    /**
     * 图生图：以上传人像为 subject_reference，生成卡通风格图（与文档 Image-to-Image 一致）。
     * 参考图要求见官方说明：JPG/PNG，小于 10MB，正面人像效果最佳。
     */
    public byte[] generateCartoonFromPortrait(byte[] imageBytes, String mimeType) throws Exception {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                    "未配置 MiniMax API Key，请在环境变量 MINIMAX_API_KEY 或 application.properties 中设置 minimax.api-key");
        }
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalStateException("图片数据为空");
        }
        if (imageBytes.length > 10 * 1024 * 1024) {
            throw new IllegalStateException("图片需小于 10MB（MiniMax 参考图限制）");
        }

        int attempts = Math.max(1, Math.min(8, maxAttempts));
        String dataUrlMime = normalizeDataUrlMime(mimeType);
        String dataUrl = "data:" + dataUrlMime + ";base64," + Base64.getEncoder().encodeToString(imageBytes);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", model);
        body.put("prompt", truncate(CARTOON_PORTRAIT_PROMPT, PROMPT_MAX_LEN));
        body.put("aspect_ratio", aspectRatio);
        body.put("response_format", "base64");

        ArrayNode refs = objectMapper.createArrayNode();
        ObjectNode ref = objectMapper.createObjectNode();
        ref.put("type", "character");
        ref.put("image_file", dataUrl);
        refs.add(ref);
        body.set("subject_reference", refs);

        log.info("[MiniMax] 图生图卡通化 model={} aspectRatio={} refBytes={} mime={} 最多尝试 {} 次",
                model, aspectRatio, imageBytes.length, dataUrlMime, attempts);

        return postImageGeneration(body, attempts);
    }

    static String normalizeDataUrlMime(String mimeType) {
        if (mimeType == null || mimeType.isBlank()) {
            return "image/jpeg";
        }
        String m = mimeType.split(";")[0].trim().toLowerCase();
        if (m.equals("image/jpg")) {
            return "image/jpeg";
        }
        if (m.equals("image/jpeg") || m.equals("image/png")) {
            return m;
        }
        throw new IllegalStateException("仅支持 JPEG 或 PNG 作为参考图");
    }

    private byte[] postImageGeneration(ObjectNode body, int attempts) throws Exception {
        String url = imageGenerationEndpoint(apiBase);
        String jsonBody = objectMapper.writeValueAsString(body);

        IllegalStateException lastBizError = null;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofMinutes(3))
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey.trim())
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                    .build();

            long httpStart = System.nanoTime();
            log.info("[MiniMax] 第 {}/{} 次：开始阻塞等待 HTTP 响应…", attempt, attempts);
            HttpResponse<String> response;
            try {
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("调用 MiniMax 时被中断，请重试", e);
            } catch (IOException e) {
                log.error("MiniMax 网络错误: {}", e.toString());
                throw new IllegalStateException("无法连接 MiniMax 或网络异常: " + describeIo(e), e);
            }
            long httpEnd = System.nanoTime();
            log.info("[MiniMax] HTTP 结束 status={} bodyLen={} 耗时 {} ms",
                    response.statusCode(),
                    response.body() != null ? response.body().length() : 0,
                    (httpEnd - httpStart) / 1_000_000L);

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                log.warn("[MiniMax] 非 2xx 响应 body={}", preview(response.body(), 500));
                throw new IllegalStateException("MiniMax 接口 HTTP " + response.statusCode() + ": " + response.body());
            }

            JsonNode root = objectMapper.readTree(response.body());
            int code = root.path("base_resp").path("status_code").asInt(-1);
            if (code == 0) {
                return decodeImageFromSuccessBody(root, response.body());
            }

            String msg = root.path("base_resp").path("status_msg").asText("");
            log.warn("[MiniMax] 业务失败 status_code={} status_msg={} body={}", code, msg, preview(response.body(), 800));

            if (RETRYABLE_STATUS_CODES.contains(code) && attempt < attempts) {
                long waitMs = 1000L * (1L << (attempt - 1));
                log.warn("[MiniMax] 错误码 {} 为可重试（官方建议稍后重试），{} ms 后进行第 {} 次调用…", code, waitMs, attempt + 1);
                try {
                    Thread.sleep(waitMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("重试等待被中断", ie);
                }
                continue;
            }

            lastBizError = new IllegalStateException("MiniMax 返回错误 [" + code + "] " + msg + " — " + response.body());
            break;
        }
        if (lastBizError != null) {
            throw lastBizError;
        }
        throw new IllegalStateException("MiniMax 调用未返回成功结果");
    }

    private byte[] decodeImageFromSuccessBody(JsonNode root, String rawBody) throws IllegalStateException {
        JsonNode images = root.path("data").path("image_base64");
        if (!images.isArray() || images.isEmpty()) {
            log.warn("[MiniMax] 无 image_base64 字段或为空 body={}", preview(rawBody, 800));
            throw new IllegalStateException("MiniMax 未返回 image_base64: " + rawBody);
        }
        String b64 = images.get(0).asText(null);
        if (b64 == null || b64.isBlank()) {
            throw new IllegalStateException("image_base64 为空");
        }
        b64 = stripDataUrlBase64(b64);
        try {
            byte[] decoded = Base64.getDecoder().decode(b64);
            log.info("[MiniMax] Base64 解码成功 图片字节数={}", decoded.length);
            return decoded;
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("MiniMax 返回的 Base64 无法解码，请检查接口或图片格式", e);
        }
    }

    static String preview(String s, int max) {
        if (s == null) {
            return "null";
        }
        String t = s.replace("\r", " ").replace("\n", " ");
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }

    static String stripDataUrlBase64(String raw) {
        String s = raw.trim();
        int i = s.indexOf("base64,");
        if (i >= 0) {
            return s.substring(i + "base64,".length()).trim();
        }
        return s;
    }

    static String describeIo(IOException e) {
        String m = e.getMessage();
        return (m != null && !m.isBlank()) ? m : e.getClass().getSimpleName();
    }

    /**
     * 与 Python 示例一致：{@code https://api.minimaxi.com/v1/image_generation}。
     * 若配置已含 {@code /v1}，则不再重复拼接。
     */
    static String imageGenerationEndpoint(String apiBase) {
        String base = normalizeBase(apiBase);
        if (base.endsWith("/v1")) {
            return base + "/image_generation";
        }
        return base + "/v1/image_generation";
    }

    static String normalizeBase(String base) {
        if (base == null || base.isBlank()) {
            return "https://api.minimaxi.com";
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    static String truncate(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    String buildMoodPrompt(String userText) {
        String t = userText == null ? "" : userText.trim();
        if (t.isEmpty()) {
            t = "平静与期待";
        }
        return """
                Create a single striking artistic image that visually expresses the emotional mood and inner feeling described below.
                Style: expressive, atmospheric, symbolic — colors and composition should reflect the mood (joy, melancholy, tension, calm, etc.).
                No text, no letters, no watermark. Square composition, rich mood, suitable as emotional pixel art source.

                Author's words and mood to express:
                """ + t;
    }
}
