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

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

@Service
public class TranslationService {

    private static final Logger log = LoggerFactory.getLogger(TranslationService.class);

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${minimax.api-key}")
    private String apiKey;

    @Value("${minimax.api-base:https://api.minimaxi.com}")
    private String apiBase;

    @Value("${minimax.text-model:abab6.5-s-chat}")
    private String textModel;

    /**
     * 将用户输入翻译/优化为中文绘图提示词
     */
    public String translateToChinese(String userText) {
        if (userText == null || userText.trim().isEmpty()) {
            return "平静的心情";
        }

        try {
            String url = combineUrl(apiBase, "/v1/text_completion_v2");
            
            ObjectNode root = objectMapper.createObjectNode();
            root.put("model", textModel);
            
            ArrayNode messages = root.putArray("messages");
            messages.addObject()
                    .put("role", "system")
                    .put("content", "你是一个心情翻译专家和绘图提示词优化师。请将用户输入的任何语言的心情描述（如果是中文则进行润色）转换成一段简练的、适合作为 AI 绘画提示词的中文描述。只输出翻译或优化后的中文结果，不要包含任何解释。");
            messages.addObject()
                    .put("role", "user")
                    .put("content", userText);

            String jsonBody = objectMapper.writeValueAsString(root);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey.trim())
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                    .build();

            log.info("[Translate] 开始请求 MiniMax 文本模型 model={} text={}", textModel, userText);
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

            if (response.statusCode() != 200) {
                log.error("[Translate] 请求失败 httpStatus={} body={}", response.statusCode(), response.body());
                return userText; // 降级：返回原文
            }

            JsonNode responseJson = objectMapper.readTree(response.body());
            String result = responseJson.path("choices").path(0).path("message").path("content").asText(userText).trim();
            
            // 去除可能的引号
            if (result.startsWith("\"") && result.endsWith("\"")) {
                result = result.substring(1, result.length() - 1);
            }

            log.info("[Translate] 翻译/优化结果: {}", result);
            return result;

        } catch (Exception e) {
            log.error("[Translate] 翻译过程发生异常", e);
            return userText; // 降级：返回原文
        }
    }

    private String combineUrl(String base, String path) {
        String b = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        return b + path;
    }
}
