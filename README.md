# 心情拼豆 (Mood Pixel Art) 🎨

[![Spring Boot](https://img.shields.io/badge/Backend-Spring%20Boot%203.2-brightgreen)](https://spring.io/projects/spring-boot)
[![Vue 3](https://img.shields.io/badge/Frontend-Vue%203-blue)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Build-Vite%205-646cff)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/3D-Three.js-black)](https://threejs.org/)

**心情拼豆** 是一款结合了人工智能（AI）、像素艺术（Pixel Art）与 3D 体素建模的创意应用。它可以将您的文字心情、照片、3D 模型或股票收益截图，一键转化为精美的像素风作品，并提供专业的拼豆（Perler Beads）底稿方案。

---

## 📖 项目概述

本项目为单页 Web 应用（Vue 3 + Vite）配合 Spring Boot 后端，支持四类核心能力：

| 模块 | 名称 | 处理位置 | 是否依赖后端 | 核心服务 |
| :--- | :--- | :--- | :--- | :--- |
| **A** | **文字心情** | 前端 UI + 后端生图与像素化 | 是 | MiniMax |
| **B** | **上传拼豆** | 本地 Canvas / 后端人像卡通化 | 卡通化时需要 | **Xais (OpenAI 兼容)** |
| **C** | **股票配图** | 浏览器内 OCR + 像素渲染 | 否 | Tesseract.js |
| **D** | **3D 拼豆** | 3D Voxel 变换 + TripoSR 2D 转 3D | 实时生成需 GPU | **Three.js / TripoSR** |

---

## 🚀 核心功能详解

### 1. 文字心情 (Mood to Pixel)
*   **流程**：支持文案输入或 **Web Speech API 浏览器原生语音输入**。后端调用 MiniMax 生成图片并自动像素化。
*   **特点**：自动根据语境追加“拼豆艺术”提示词，生成即底稿。

### 2. 照片拼豆 (Photo to Perler)
*   **人像卡通化**：**[队友更新]** 切换至 **Xais** 引擎（OpenAI 兼容接口），大幅提升了人像转卡通的识别准确度与美感。
*   **底稿映射**：支持 MARD、COCO 等主流品牌色号的一键映射与颗数统计。

### 3. 股票配图 (Stock Market Mood)
*   **高效率识别**：**[最新优化]** 采用了全新的单次 PSM 精准扫描策略，相比旧版提速 200%。
*   **离线识别**：纯前端 Tesseract.js OCR 解析盈亏截图，保护隐私。根据盈利/亏损状态自动匹配不同的像素风搞笑表情包。
*   **实时进度**：增加了 OCR 识别进度的百分比提示，处理逻辑不再“黑盒”。

### 4. 3D 拼豆 (3D Voxel Art)
*   **模型体素化**：上传 `.obj` 或 `.glb` 模型，实时进行 3D 体素化计算，支持逐层切片查看图纸。
*   **2D 转 3D**：集成 TripoSR 客户端，支持从一张照片直接生成 3D 拼豆切片图稿。
*   **UI 隔离**：**[修复]** 切换标签时自动清理旧模式结果，防止 2D/3D 内容重叠粘连。

---

## 🛠️ 技术栈与架构

### 前端 (Frontend)
*   **框架**：Vue 3 (Composition API)、Vite 5
*   **3D 引擎**：Three.js (用于体素预览与空间计算)
*   **AI 接口**：Web Speech API (语音)、TripoSR Client (2D to 3D)

### 后端 (Backend)
*   **核心**：Java 17、Spring Boot 3.2.5
*   **外部服务**：
    *   **MiniMax**：文本生成图像。
    *   **Xais (OpenAI Compatible)**：**[新]** 专门用于高品質的人像卡通化处理。

---

## ⚙️ 配置说明

### 后端配置 (`application.properties`)

| 配置项 | 含义 | 示例 |
| :--- | :--- | :--- |
| `minimax.api-key` | MiniMax 秘钥 | `sk-xxxx` |
| `xais.api-key` | **[新]** Xais 秘钥 | `x-xxxx` |
| `xais.chat-url` | Xais 接口地址 | `https://sg2.dchai.cn/v1/chat/completions` |
| `xais.model` | Xais 模型名称 | `Nano_Banana_Pro_2K_0` |

---

## 📡 后端 API 接口

1.  `POST /api/mood-pixel`: 文字生拼豆。
2.  `POST /api/perler-cartoonize`: **[更新]** 使用 Xais 引擎进行卡通化。

---

## 📦 本地开发

1. **后端**：`mvn spring-boot:run` (端口 8080)
2. **前端**：`npm run dev` (端口 5173，已配置代理)

---

> [!IMPORTANT]
> **2D to 3D 提示**：3D 模式下的 TripoSR 功能需要远程 GPU 集群支持，确保 SSH 隧道正确连接至 `127.0.0.1:7860`。

---

*本项目由多人团队协作开发，同步了队友 xiangsu2 版本的最新 AI 绘图优化。*
