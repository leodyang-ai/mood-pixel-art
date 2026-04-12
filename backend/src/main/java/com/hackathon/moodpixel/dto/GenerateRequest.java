package com.hackathon.moodpixel.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GenerateRequest(
        @NotBlank(message = "文字内容不能为空")
        @Size(max = 2000, message = "文字过长")
        String text,
        /** 像素块大小，默认 16 */
        Integer blockSize
) {
    public int blockSizeOrDefault() {
        return blockSize == null ? 16 : Math.max(2, Math.min(64, blockSize));
    }
}
