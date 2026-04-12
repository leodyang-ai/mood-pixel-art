package com.hackathon.moodpixel.dto;

/**
 * 拼豆用量：某一种颜色在逻辑网格中需要的豆子颗数。
 */
public record BeadColorStat(
        /** 如 #A1B2C3 */
        String hex,
        int r,
        int g,
        int b,
        int beadCount
) {}
