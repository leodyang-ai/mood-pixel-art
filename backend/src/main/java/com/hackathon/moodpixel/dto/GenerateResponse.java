package com.hackathon.moodpixel.dto;

import java.util.List;

public record GenerateResponse(
        String mimeType,
        String base64Image,
        /** 按用量从多到少排序的拼豆颜色统计（一格一颗，对应逻辑网格） */
        List<BeadColorStat> beadPalette,
        int gridWidth,
        int gridHeight,
        int totalBeads
) {}
