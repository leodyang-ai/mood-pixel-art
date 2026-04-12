package com.hackathon.moodpixel.dto;

import java.util.List;

/**
 * 像素化结果：展示用 PNG 字节 + 逻辑网格上的拼豆颜色统计。
 */
public record PixelatePngResult(
        byte[] pngBytes,
        List<BeadColorStat> beadPalette,
        int gridWidth,
        int gridHeight
) {
    public int totalBeads() {
        return gridWidth * gridHeight;
    }
}
