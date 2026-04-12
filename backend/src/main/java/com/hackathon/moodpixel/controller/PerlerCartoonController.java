package com.hackathon.moodpixel.controller;

import com.hackathon.moodpixel.dto.CartoonizeResponse;
import com.hackathon.moodpixel.service.XaisChatImageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Base64;

@RestController
@RequestMapping("/api")
public class PerlerCartoonController {

    private static final Logger log = LoggerFactory.getLogger(PerlerCartoonController.class);

    private static final long MAX_BYTES = 10L * 1024 * 1024;

    private final XaisChatImageService xaisChatImageService;

    public PerlerCartoonController(XaisChatImageService xaisChatImageService) {
        this.xaisChatImageService = xaisChatImageService;
    }

    /**
     * 将上传的 JPEG/PNG 人像经 Xais（OpenAI 兼容 chat/completions 图生图）转为卡通风格，返回 base64 图片。
     */
    @PostMapping(value = "/perler-cartoonize", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public CartoonizeResponse perlerCartoonize(@RequestPart("file") MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalStateException("请上传图片文件");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new IllegalStateException("图片需小于 10MB");
        }
        String ct = file.getContentType();
        if (ct == null || (!ct.toLowerCase().startsWith("image/jpeg") && !ct.toLowerCase().startsWith("image/png"))) {
            throw new IllegalStateException("仅支持 JPEG 或 PNG 图片");
        }

        long t0 = System.nanoTime();
        byte[] raw = xaisChatImageService.generateCartoonFromPortrait(file.getBytes(), ct);
        long t1 = System.nanoTime();
        log.info("[perler-cartoonize] Xais 返回 bytes={} 耗时 {} ms", raw.length, (t1 - t0) / 1_000_000L);

        String mime = sniffImageMime(raw);
        String b64 = Base64.getEncoder().encodeToString(raw);
        return new CartoonizeResponse(mime, b64);
    }

    static String sniffImageMime(byte[] data) {
        if (data == null || data.length < 4) {
            return "image/png";
        }
        if (data[0] == (byte) 0xFF && data[1] == (byte) 0xD8) {
            return "image/jpeg";
        }
        if (data[0] == (byte) 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') {
            return "image/png";
        }
        return "image/png";
    }
}
