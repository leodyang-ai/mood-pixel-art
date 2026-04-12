import JSZip from 'jszip';

export class ThreeMFExporter {
    constructor(beadSizeMm = 0.1) {
        this.beadSizeMm = beadSizeMm;
    }

    /**
     * 将体素网格导出为 .3mf 文件
     * @param {Array} voxelGrid - [z][y][x] = { color } or null
     * @returns {Promise<Blob>}
     */
    async export3MF(voxelGrid) {
        if (!voxelGrid) throw new Error('没有可导出的体素数据');

        const zip = new JSZip();

        // 1. 生成 [Content_Types].xml
        zip.file('[Content_Types].xml', this._generateContentTypes());

        // 2. 生成 _rels/.rels
        zip.file('_rels/.rels', this._generateRels());

        // 3. 生成 3D/3dmodel.model
        const modelXml = this._generateModelXml(voxelGrid);
        zip.file('3D/3dmodel.model', modelXml);

        return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
    }

    _generateContentTypes() {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
    }

    _generateRels() {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
    }

    _generateModelXml(voxelGrid) {
        const sz = this.beadSizeMm;
        let vertices = [];
        let triangles = [];
        let vertexMap = new Map(); // key: "x,y,z", value: index

        const addVertex = (x, y, z) => {
            const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
            if (vertexMap.has(key)) return vertexMap.get(key);
            const index = vertices.length;
            vertices.push(`<vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}" />`);
            vertexMap.set(key, index);
            return index;
        };

        const addFace = (v1, v2, v3, v4) => {
            // v1-v2-v3, v1-v3-v4
            triangles.push(`<triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
            triangles.push(`<triangle v1="${v1}" v2="${v3}" v3="${v4}" />`);
        };

        // 遍历所有体素
        const depth = voxelGrid.length;
        const height = voxelGrid[0].length;
        const width = voxelGrid[0][0].length;

        for (let z = 0; z < depth; z++) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (voxelGrid[z][y][x]) {
                        // 每一个体素是一个立方体，只生成可见面（可选优化，这里为了简单全生成）
                        const x0 = x * sz, x1 = (x + 1) * sz;
                        const y0 = y * sz, y1 = (y + 1) * sz;
                        const z0 = z * sz, z1 = (z + 1) * sz;

                        // 8 个顶点
                        const p0 = addVertex(x0, y0, z0);
                        const p1 = addVertex(x1, y0, z0);
                        const p2 = addVertex(x1, y1, z0);
                        const p3 = addVertex(x0, y1, z0);
                        const p4 = addVertex(x0, y0, z1);
                        const p5 = addVertex(x1, y0, z1);
                        const p6 = addVertex(x1, y1, z1);
                        const p7 = addVertex(x0, y1, z1);

                        // 6 个面
                        addFace(p3, p2, p1, p0); // back
                        addFace(p4, p5, p6, p7); // front
                        addFace(p0, p1, p5, p4); // bottom
                        addFace(p2, p3, p7, p6); // top
                        addFace(p0, p4, p7, p3); // left
                        addFace(p1, p2, p6, p5); // right
                    }
                }
            }
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          ${vertices.join('\n          ')}
        </vertices>
        <triangles>
          ${triangles.join('\n          ')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;
    }
}
