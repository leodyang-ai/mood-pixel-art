package com.hackathon.moodpixel.controller;

import com.hackathon.moodpixel.dto.GenerateRequest;
import com.hackathon.moodpixel.dto.GenerateResponse;
import com.hackathon.moodpixel.dto.PixelatePngResult;
import com.hackathon.moodpixel.service.MiniMaxImageService;
import com.hackathon.moodpixel.service.PixelateService;
import com.hackathon.moodpixel.service.TranslationService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Base64;

@RestController
@RequestMapping("/api")
public class MoodImageController {

    private static final Logger log = LoggerFactory.getLogger(MoodImageController.class);

    private final MiniMaxImageService miniMaxImageService;
    private final PixelateService pixelateService;
    private final TranslationService translationService;

    public MoodImageController(MiniMaxImageService miniMaxImageService, 
                               PixelateService pixelateService,
                               TranslationService translationService) {
        this.miniMaxImageService = miniMaxImageService;
        this.pixelateService = pixelateService;
        this.translationService = translationService;
    }

    @PostMapping(value = "/mood-pixel", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public GenerateResponse moodPixel(@Valid @RequestBody GenerateRequest req) throws Exception {
        long t0 = System.nanoTime();
        String originalText = req.text();
        
        // --- Translation/Processing Step ---
        String text = translationService.translateToChinese(originalText);
        
        text=text+"强制要求：生成的图片和前面描述强相关，附加要求生成可爱拼豆像素艺术创作。Q版比例，超级可爱，非常简化的细节。来自有限调色板的充满活力的复古游戏颜色。由非常清晰、块状的像素定义。粗体的深色像素轮廓，干净的平涂色域。小型、紧凑的设计。低分辨率，隔离在简单的浅灰色工作台背景上。完美的拼豆图案。";
        int block = req.blockSizeOrDefault();
        log.info("[mood-pixel] 收到请求 textLen={} blockSize={}", text != null ? text.length() : 0, block);

        byte[] rawPng = miniMaxImageService.generateMoodImageBytes(text);
        long t1 = System.nanoTime();
        log.info("[mood-pixel] MiniMax 返回原图 bytes={} 本阶段耗时 {} ms", rawPng.length, ms(t0, t1));

        PixelatePngResult pixel = pixelateService.pixelatePngWithBeadStats(rawPng, block);
        long t2 = System.nanoTime();
        log.info("[mood-pixel] 像素化完成 bytes={} 逻辑网格 {}×{} 颜色种数={} 本阶段耗时 {} ms",
                pixel.pngBytes().length, pixel.gridWidth(), pixel.gridHeight(), pixel.beadPalette().size(), ms(t1, t2));

        String b64 = Base64.getEncoder().encodeToString(pixel.pngBytes());
        long t3 = System.nanoTime();
        log.info("[mood-pixel] 全部完成 总耗时 {} ms base64Len={} 总豆数={}", ms(t0, t3), b64.length(), pixel.totalBeads());
        return new GenerateResponse(
                "image/png",
                b64,
                pixel.beadPalette(),
                pixel.gridWidth(),
                pixel.gridHeight(),
                pixel.totalBeads());
    }

    private static long ms(long startNanos, long endNanos) {
        return (endNanos - startNanos) / 1_000_000L;
    }
}
