import { Client, handle_file } from "@gradio/client";

export class TripoSRClient {
    constructor(baseUrl = '/triposr', username = 'root', password = 'ruanxh-5051') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.username = username;
        this.password = password;
        this.client = null;
    }

    /**
     * 初始化连接
     */
    async init() {
        const fullUrl = window.location.origin + this.baseUrl;
        this.client = await Client.connect(fullUrl, {
            auth: [this.username, this.password]
        });
    }

    /**
     * 执行全流程：预处理 -> 生成 3D
     * @param {File|Blob} imageFile 
     * @param {Function} onProgress 进度回调 (stage: string) => void
     */
    async predict3D(imageFile, onProgress = () => {}) {
        if (!this.client) {
            onProgress('正在连接至 GPU 远程集群...');
            await this.init();
        }

        try {
            // 阶段 1: 预处理
            onProgress('阶段 1/3: 正在进行 AI 图像预处理 (去背景/裁剪)...');
            const preprocessResult = await this.client.predict("/preprocess", [
                handle_file(imageFile),
                true, // remove_bg
                0.85  // foreground_ratio
            ]);

            const processedImage = preprocessResult.data[0];
            if (!processedImage) throw new Error('预处理阶段未返回有效图片');

            // 阶段 2: 3D 生成
            onProgress('阶段 2/3: 图像已就绪，AI 正在推断 3D 结构 (约需 15-30s)...');
            const generateResult = await this.client.predict("/generate", [
                handle_file(processedImage),
                256 // mc_resolution
            ]);

            // 阶段 3: 获取结果文件并下载
            onProgress('阶段 3/3: 3D 网格生成成功！正在从远程端下载模型数据...');
            const fileData = generateResult.data[0];
            const fileUrl = fileData.url;
            const filename = fileData.orig_name || 'model.obj';

            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error('下载模型文件失败');
            const blob = await response.blob();
            
            onProgress('渲染中...');
            return { blob, filename };
        } catch (error) {
            console.error("TripoSR Prediction Error:", error);
            throw error;
        }
    }
}
