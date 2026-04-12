package com.hackathon.moodpixel.service;

import com.hackathon.moodpixel.dto.BeadColorStat;
import com.hackathon.moodpixel.dto.PixelatePngResult;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class PixelateService {

    /**
     * 像素化并输出拼豆统计：在「逻辑网格」上每种颜色一颗豆子（与 MiroFish 类拼豆图一致，按格计数而非放大后重复像素）。
     */
    public PixelatePngResult pixelatePngWithBeadStats(byte[] imageBytes, int blockSize) throws IOException {
        if (blockSize < 2) {
            blockSize = 2;
        }
        try (InputStream in = new ByteArrayInputStream(imageBytes)) {
            BufferedImage src = ImageIO.read(in);
            if (src == null) {
                throw new IOException("无法解析图片数据");
            }
            BufferedImage[] pair = pixelateToGridAndDisplay(src, blockSize);
            BufferedImage logicalGrid = pair[0];
            BufferedImage display = pair[1];

            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(display, "png", bos);

            List<BeadColorStat> palette = countBeadsOnLogicalGrid(logicalGrid);
            int gw = logicalGrid.getWidth();
            int gh = logicalGrid.getHeight();
            return new PixelatePngResult(bos.toByteArray(), palette, gw, gh);
        }
    }

    /**
     * @return [0]=逻辑网格（一格一色，用于拼豆计数），[1]=放大后的展示图
     */
    BufferedImage[] pixelateToGridAndDisplay(BufferedImage src, int blockSize) {
        int w = src.getWidth();
        int h = src.getHeight();
        int smallW = Math.max(1, w / blockSize);
        int smallH = Math.max(1, h / blockSize);

        BufferedImage small = new BufferedImage(smallW, smallH, BufferedImage.TYPE_INT_RGB);
        Graphics2D g1 = small.createGraphics();
        try {
            g1.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
            g1.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_SPEED);
            g1.drawImage(src, 0, 0, smallW, smallH, null);
        } finally {
            g1.dispose();
        }

        quantizeLogicalGridMedianCut128(small);

        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g2 = out.createGraphics();
        try {
            g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
            g2.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_SPEED);
            g2.drawImage(small, 0, 0, w, h, null);
        } finally {
            g2.dispose();
        }
        return new BufferedImage[] { small, out };
    }

    /**
     * 中位切分（Median Cut）生成至多 128 种代表色，再逐格映射到最近色。
     * 比均匀切 RGB 立方体更能保留细节，统计表里通常会出现远多于十几种的有效配色。
     */
    static void quantizeLogicalGridMedianCut128(BufferedImage logicalGrid) {
        int w = logicalGrid.getWidth();
        int h = logicalGrid.getHeight();
        List<Integer> all = new ArrayList<>(w * h);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                all.add(logicalGrid.getRGB(x, y) & 0xFFFFFF);
            }
        }
        int[] palette = MedianCutQuantizer.buildPalette(all);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int oldRgb = logicalGrid.getRGB(x, y) & 0xFFFFFF;
                int q = MedianCutQuantizer.nearestPaletteColor(oldRgb, palette);
                logicalGrid.setRGB(x, y, 0xFF000000 | q);
            }
        }
    }

    static List<BeadColorStat> countBeadsOnLogicalGrid(BufferedImage logicalGrid) {
        int w = logicalGrid.getWidth();
        int h = logicalGrid.getHeight();
        Map<Integer, Integer> freq = new HashMap<>(Math.max(16, w * h / 4));
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = logicalGrid.getRGB(x, y) & 0xFFFFFF;
                freq.merge(rgb, 1, Integer::sum);
            }
        }
        List<Map.Entry<Integer, Integer>> entries = new ArrayList<>(freq.entrySet());
        entries.sort(Comparator.<Map.Entry<Integer, Integer>>comparingInt(Map.Entry::getValue).reversed());
        List<BeadColorStat> list = new ArrayList<>(entries.size());
        for (Map.Entry<Integer, Integer> e : entries) {
            list.add(toBeadColorStat(e.getKey(), e.getValue()));
        }
        return List.copyOf(list);
    }

    private static BeadColorStat toBeadColorStat(int rgb24, int count) {
        int r = (rgb24 >> 16) & 0xFF;
        int g = (rgb24 >> 8) & 0xFF;
        int b = rgb24 & 0xFF;
        String hex = String.format("#%06X", rgb24);
        return new BeadColorStat(hex, r, g, b, count);
    }

    public BufferedImage pixelate(BufferedImage src, int blockSize) {
        return pixelateToGridAndDisplay(src, blockSize)[1];
    }
}
