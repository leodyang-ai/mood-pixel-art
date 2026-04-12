import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class VoxelEngine {
    constructor() {
        this.voxels = []; 
        this.resolution = 32;
        this.size = { x: 0, y: 0, z: 0 };
    }

    async loadModel(file) {
        const url = URL.createObjectURL(file);
        const name = file.name.toLowerCase();
        
        let loader;
        if (name.endsWith('.obj')) {
            loader = new OBJLoader();
        } else if (name.endsWith('.glb') || name.endsWith('.gltf')) {
            loader = new GLTFLoader();
        } else {
            throw new Error('不支持的文件格式');
        }

        return new Promise((resolve, reject) => {
            loader.load(url, (result) => {
                URL.revokeObjectURL(url);
                let model = result.scene || result;
                if (!model) return reject(new Error('内容为空'));
                resolve(model);
            }, undefined, reject);
        });
    }

    /**
     * 实现更鲁棒的体素化 (适用于非闭合 AI 模型)
     */
    async voxelize(mesh, resolution = 32) {
        if (!mesh) throw new Error('输入为空');
        this.resolution = resolution;

        // 1. 预处理：计算真实几何边界
        const box = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        // 确保整体居中
        mesh.traverse(obj => {
            if (obj.isMesh) {
                obj.geometry.center(); // 对齐几何中心
            }
        });

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim === 0) throw new Error('模型无效');
        const scale = resolution / maxDim;
        
        this.size = {
            x: Math.ceil(size.x * scale),
            y: Math.ceil(size.y * scale),
            z: Math.ceil(size.z * scale)
        };
        
        this.voxels = Array.from({ length: this.size.z }, () =>
            Array.from({ length: this.size.y }, () =>
                new Array(this.size.x).fill(null)
            )
        );

        // 2. 射线检测器配置
        const raycaster = new THREE.Raycaster();
        const downDir = new THREE.Vector3(0, -1, 0);
        const upDir = new THREE.Vector3(0, 1, 0);
        
        const step = 1 / scale;
        const halfStep = step / 2;

        // 3. 逐列扫描
        for (let iz = 0; iz < this.size.z; iz++) {
            for (let ix = 0; ix < this.size.x; ix++) {
                // 计算当前采样柱的中心世界坐标
                const worldX = (ix * step) + halfStep - (this.size.x * step / 2);
                const worldZ = (iz * step) + halfStep - (this.size.z * step / 2);

                // 从底部向上射，从顶部向下射，双向采样以应对单面模型
                const startUp = new THREE.Vector3(worldX, -size.y, worldZ);
                const startDown = new THREE.Vector3(worldX, size.y, worldZ);

                raycaster.set(startUp, upDir);
                const hitsUp = raycaster.intersectObject(mesh, true);
                
                raycaster.set(startDown, downDir);
                const hitsDown = raycaster.intersectObject(mesh, true);

                // 合并并去重交点
                const allHits = [...hitsUp, ...hitsDown].sort((a, b) => a.point.y - b.point.y);
                if (allHits.length === 0) continue;

                // 算法逻辑：
                // 如果至少有一个点，我们就认为是“有东西”
                // 对于拼豆来说，即便内部不实心，我们也需要保证“外壳”是完整的
                
                // 将交点的世界 Y 映射到体素坐标 iy
                allHits.forEach(hit => {
                    const iy = Math.floor((hit.point.y + size.y/2) * scale);
                    if (iy >= 0 && iy < this.size.y) {
                        const color = this._getIntersectionColor(hit);
                        this.voxels[iz][iy][ix] = { color };
                    }
                });

                // 如果有多个交点，填充它们之间的缝隙（如果是闭合模型）
                if (allHits.length >= 2) {
                    for (let i = 0; i < allHits.length - 1; i++) {
                        const y1 = allHits[i].point.y;
                        const y2 = allHits[i+1].point.y;
                        const color = this._getIntersectionColor(allHits[i]);

                        // 如果两个交点距离较近，填充它们
                        const iyStart = Math.ceil((y1 + size.y/2) * scale);
                        const iyEnd = Math.floor((y2 + size.y/2) * scale);
                        
                        for (let iy = iyStart; iy <= iyEnd; iy++) {
                            if (iy >= 0 && iy < this.size.y) {
                                if (!this.voxels[iz][iy][ix]) {
                                    this.voxels[iz][iy][ix] = { color };
                                }
                            }
                        }
                    }
                }
            }
        }

        return this.voxels;
    }

    _getIntersectionColor(intersect) {
        if (intersect.object && intersect.object.material) {
             const m = Array.isArray(intersect.object.material) ? intersect.object.material[0] : intersect.object.material;
             if (m.color) return '#' + m.color.getHexString();
        }
        return '#FFFFFF';
    }
}
