package com.hackathon.moodpixel.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Xais AI：OpenAI 兼容 {@code POST /v1/chat/completions}，图生图返回 Markdown 中的图片 URL。
 */
@Service
public class XaisChatImageService {

    private static final Logger log = LoggerFactory.getLogger(XaisChatImageService.class);

    private static final Pattern MD_IMAGE = Pattern.compile("!\\[[^]]*]\\((https?://[^)\\s]+)\\)");

    private static final String CARTOON_PROMPT = String.join(" ",
            "图生图：在严格保留参考图中人物身份、发型分区与发色、服装款式与主色的前提下，",
            "将人物转为超可爱Q版卡通插画（大头小身、简化五官与细节、扁平色块、柔和勾边）。",
            "不要换成另一个人，不要写实照片；背景简洁干净。",
            "长宽比要求：");

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${xais.chat-url:https://sg2.dchai.cn/v1/chat/completions}")
    private String chatCompletionsUrl;

    @Value("${xais.model:Nano_Banana_Pro_2K_0}")
    private String model;

    @Value("${xais.api-key:}")
    private String apiKey;

    /**
     * 图生图卡通化：上传图以 Data URL 传入，解析助手返回 Markdown 中的首张图并下载为字节。
     * 失败时自动重试 1 次（共 2 次）。
     */
    public byte[] generateCartoonFromPortrait(byte[] imageBytes, String mimeType) throws Exception {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("未配置 Xais API Key，请设置环境变量 XAIS_API_KEY 或 xais.api-key");
        }
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalStateException("图片数据为空");
        }
        if (imageBytes.length > 10 * 1024 * 1024) {
            throw new IllegalStateException("图片需小于 10MB");
        }

        String dataUrlMime = MiniMaxImageService.normalizeDataUrlMime(mimeType);
        String dataUrl = "data:" + dataUrlMime + ";base64," + java.util.Base64.getEncoder().encodeToString(imageBytes);
        String ratioHint = promptAspectRatioHint(imageBytes);
        String prompt = CARTOON_PROMPT + ratioHint + "。";

        Exception last = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                String markdown = callChatCompletionsOnce(dataUrl, prompt);
                String imageUrl = extractFirstImageUrl(markdown);
                if (imageUrl == null || imageUrl.isBlank()) {
                    throw new IllegalStateException("Xais 响应中未解析到图片 URL，原始片段: "
                            + MiniMaxImageService.preview(markdown, 400));
                }
                byte[] bytes = downloadImage(imageUrl);
                log.info("[Xais] 图生图成功 bytes={} attempt={}", bytes.length, attempt);
                return bytes;
            } catch (Exception e) {
                last = e;
                log.warn("[Xais] 第 {} 次调用失败: {}", attempt, e.toString());
                if (attempt < 2) {
                    try {
                        Thread.sleep(400L);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException("重试等待被中断", ie);
                    }
                }
            }
        }
        throw new IllegalStateException("Xais 图生图失败（已重试）", last);
    }

    private String callChatCompletionsOnce(String imageDataUrl, String textPrompt) throws IOException, InterruptedException {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("model", model);

        ArrayNode messages = objectMapper.createArrayNode();
        ObjectNode userMsg = objectMapper.createObjectNode();
        userMsg.put("role", "user");

        ArrayNode content = objectMapper.createArrayNode();
        ObjectNode textPart = objectMapper.createObjectNode();
        textPart.put("type", "text");
        textPart.put("text", textPrompt);
        ObjectNode imgPart = objectMapper.createObjectNode();
        imgPart.put("type", "image_url");
        ObjectNode imageUrl = objectMapper.createObjectNode();
        imageUrl.put("url", imageDataUrl);
        imgPart.set("image_url", imageUrl);
        content.add(textPart);
        content.add(imgPart);
        userMsg.set("content", content);
        messages.add(userMsg);
        root.set("messages", messages);

        String json = objectMapper.writeValueAsString(root);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(chatCompletionsUrl))
                .timeout(Duration.ofSeconds(300))
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey.trim())
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();

        log.info("[Xais] POST {} model={} bodyLen={}", chatCompletionsUrl, model, json.length());
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("Xais HTTP " + response.statusCode() + ": " + MiniMaxImageService.preview(response.body(), 800));
        }
        JsonNode tree = objectMapper.readTree(response.body());
        JsonNode choices = tree.path("choices");
        if (!choices.isArray() || choices.isEmpty()) {
            throw new IllegalStateException("Xais 无 choices: " + MiniMaxImageService.preview(response.body(), 600));
        }
        String assistantContent = choices.get(0).path("message").path("content").asText("");
        if (assistantContent.isBlank()) {
            throw new IllegalStateException("Xais 助手 content 为空");
        }
        return assistantContent;
    }

    static String extractFirstImageUrl(String markdown) {
        if (markdown == null) {
            return null;
        }
        String s = markdown.replace("\\u0026", "&");
        Matcher m = MD_IMAGE.matcher(s);
        if (m.find()) {
            return m.group(1).trim();
        }
        int i = s.indexOf("https://");
        if (i >= 0) {
            int end = s.length();
            for (int j = i; j < s.length(); j++) {
                char c = s.charAt(j);
                if (c == ')' || c == ' ' || c == '\n' || c == '\r') {
                    end = j;
                    break;
                }
            }
            return s.substring(i, end).trim();
        }
        return null;
    }

    private byte[] downloadImage(String urlStr) throws IOException, InterruptedException {
        URI uri = URI.create(urlStr);
        HttpRequest get = HttpRequest.newBuilder()
                .uri(uri)
                .timeout(Duration.ofSeconds(120))
                .GET()
                .build();
        HttpResponse<byte[]> resp = httpClient.send(get, HttpResponse.BodyHandlers.ofByteArray());
        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            throw new IllegalStateException("下载生成图失败 HTTP " + resp.statusCode());
        }
        byte[] body = resp.body();
        if (body == null || body.length == 0) {
            throw new IllegalStateException("下载生成图为空");
        }
        return body;
    }

    /** 与 Xais 文档一致：在提示词中写明长宽比关键词。 */
    private static String promptAspectRatioHint(byte[] imageBytes) {
        int[] wh = MiniMaxImageService.readImageWidthHeight(imageBytes);
        if (wh == null || wh[0] <= 0 || wh[1] <= 0) {
            return "1:1";
        }
        double input = (double) wh[0] / (double) wh[1];
        String[] labels = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "5:4"};
        String best = "1:1";
        double bestScore = Double.MAX_VALUE;
        for (String label : labels) {
            String[] p = label.split(":");
            double rw = Double.parseDouble(p[0]);
            double rh = Double.parseDouble(p[1]);
            double target = rw / rh;
            double score = Math.abs(Math.log(input) - Math.log(target));
            if (score < bestScore) {
                bestScore = score;
                best = label;
            }
        }
        return best;
    }
}
