package com.hackathon.moodpixel.dto;

/**
 * 上传人像经 MiniMax 图生图卡通化后的结果，供前端再跑拼豆网格逻辑。
 */
public record CartoonizeResponse(String mimeType, String base64Image) {}
