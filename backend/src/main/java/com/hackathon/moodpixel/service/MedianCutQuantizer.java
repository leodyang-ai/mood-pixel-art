package com.hackathon.moodpixel.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Heckbert 中位切分：将颜色集合量化为至多 {@link #TARGET_COLORS} 种代表色，
 * 比均匀划分 RGB 立方体更保留层次，适合「固定 128 色」拼豆场景。
 */
final class MedianCutQuantizer {

    static final int TARGET_COLORS = 128;

    private MedianCutQuantizer() {}

    static int[] buildPalette(List<Integer> pixelsRgb24) {
        if (pixelsRgb24.isEmpty()) {
            return new int[] { 0 };
        }
        List<ColorBox> boxes = new ArrayList<>(1);
        boxes.add(new ColorBox(new ArrayList<>(pixelsRgb24)));

        while (boxes.size() < TARGET_COLORS) {
            ColorBox toSplit = pickWidestBox(boxes);
            if (toSplit == null) {
                break;
            }
            ColorBox[] pair = toSplit.splitByMedian();
            if (pair == null) {
                break;
            }
            boxes.remove(toSplit);
            boxes.add(pair[0]);
            boxes.add(pair[1]);
        }

        int[] palette = new int[boxes.size()];
        for (int i = 0; i < boxes.size(); i++) {
            palette[i] = boxes.get(i).averageRgb();
        }
        return palette;
    }

    static int nearestPaletteColor(int rgb24, int[] palette) {
        int best = palette[0];
        int bestD = Integer.MAX_VALUE;
        for (int p : palette) {
            int d = rgbDistanceSq(rgb24, p);
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        return best;
    }

    private static int rgbDistanceSq(int a, int b) {
        int ar = (a >> 16) & 0xFF;
        int ag = (a >> 8) & 0xFF;
        int ab = a & 0xFF;
        int br = (b >> 16) & 0xFF;
        int bg = (b >> 8) & 0xFF;
        int bb = b & 0xFF;
        int dr = ar - br;
        int dg = ag - bg;
        int db = ab - bb;
        return dr * dr + dg * dg + db * db;
    }

    private static ColorBox pickWidestBox(List<ColorBox> boxes) {
        ColorBox best = null;
        long bestVol = -1;
        for (ColorBox b : boxes) {
            if (b.colors.size() < 2) {
                continue;
            }
            long vol = b.boundingVolume();
            if (vol > bestVol) {
                bestVol = vol;
                best = b;
            }
        }
        return best;
    }

    private static final class ColorBox {
        final List<Integer> colors;

        ColorBox(List<Integer> colors) {
            this.colors = colors;
        }

        long boundingVolume() {
            int rMin = 256;
            int rMax = -1;
            int gMin = 256;
            int gMax = -1;
            int bMin = 256;
            int bMax = -1;
            for (int c : colors) {
                int r = (c >> 16) & 0xFF;
                int g = (c >> 8) & 0xFF;
                int b = c & 0xFF;
                rMin = Math.min(rMin, r);
                rMax = Math.max(rMax, r);
                gMin = Math.min(gMin, g);
                gMax = Math.max(gMax, g);
                bMin = Math.min(bMin, b);
                bMax = Math.max(bMax, b);
            }
            long dr = rMax - rMin + 1L;
            long dg = gMax - gMin + 1L;
            long db = bMax - bMin + 1L;
            return dr * dg * db;
        }

        ColorBox[] splitByMedian() {
            int rMin = 256;
            int rMax = -1;
            int gMin = 256;
            int gMax = -1;
            int bMin = 256;
            int bMax = -1;
            for (int c : colors) {
                int r = (c >> 16) & 0xFF;
                int g = (c >> 8) & 0xFF;
                int b = c & 0xFF;
                rMin = Math.min(rMin, r);
                rMax = Math.max(rMax, r);
                gMin = Math.min(gMin, g);
                gMax = Math.max(gMax, g);
                bMin = Math.min(bMin, b);
                bMax = Math.max(bMax, b);
            }
            int dr = rMax - rMin;
            int dg = gMax - gMin;
            int db = bMax - bMin;
            if (dr == 0 && dg == 0 && db == 0) {
                return null;
            }
            int axis;
            if (dr >= dg && dr >= db) {
                axis = 0;
            } else if (dg >= db) {
                axis = 1;
            } else {
                axis = 2;
            }
            Comparator<Integer> cmp = switch (axis) {
                case 0 -> Comparator.comparingInt(c -> (c >> 16) & 0xFF);
                case 1 -> Comparator.comparingInt(c -> (c >> 8) & 0xFF);
                default -> Comparator.comparingInt(c -> c & 0xFF);
            };
            colors.sort(cmp);
            int mid = colors.size() / 2;
            if (mid < 1 || mid >= colors.size()) {
                return null;
            }
            List<Integer> left = new ArrayList<>(colors.subList(0, mid));
            List<Integer> right = new ArrayList<>(colors.subList(mid, colors.size()));
            return new ColorBox[] { new ColorBox(left), new ColorBox(right) };
        }

        int averageRgb() {
            long r = 0;
            long g = 0;
            long b = 0;
            for (int c : colors) {
                r += (c >> 16) & 0xFF;
                g += (c >> 8) & 0xFF;
                b += c & 0xFF;
            }
            int n = colors.size();
            int ri = (int) (r / n);
            int gi = (int) (g / n);
            int bi = (int) (b / n);
            return (ri << 16) | (gi << 8) | bi;
        }
    }
}
